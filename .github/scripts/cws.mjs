#!/usr/bin/env node
// Chrome Web Store API v2 client for CI.
// Usage: cws.mjs status [--require-newer] | upload <zip> | publish | metrics [days]
// Env: ACCESS_TOKEN, CWS_PUBLISHER_ID, CWS_EXTENSION_ID
import { readFile } from 'node:fs/promises';

const API = process.env.CWS_API_BASE || 'https://chromewebstore.googleapis.com';
const POLL_MS = Number(process.env.CWS_POLL_MS || 5000);
const POLL_ATTEMPTS = 36;
const PUBLISHED_STATES = new Set(['PENDING_REVIEW', 'PUBLISHED', 'STAGED', 'PUBLISHED_TO_TESTERS']);

function fail(message) {
    console.log(`::error::${message}`);
    process.exit(1);
}

function requireEnv(name) {
    const value = process.env[name];
    if (!value) fail(`${name} is not set`);
    return value;
}

const token = requireEnv('ACCESS_TOKEN');
const itemName = `publishers/${requireEnv('CWS_PUBLISHER_ID')}/items/${requireEnv('CWS_EXTENSION_ID')}`;

function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return Math.sign(diff);
    }
    return 0;
}

async function call(method, path, { body, contentType } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(`${API}${path}`, { method, headers, body });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
    if (!res.ok) {
        const reason = (json?.error?.message || text || res.statusText).trim().replace(/\.$/, '');
        const hint = res.status === 401 || res.status === 403
            ? ' Check that the service account is added in the Chrome Web Store Developer Dashboard (Account page) and that CWS_PUBLISHER_ID is right.'
            : '';
        fail(`${method} ${path} failed with HTTP ${res.status}: ${reason}.${hint}`);
    }
    return json || {};
}

async function manifestVersion() {
    return JSON.parse(await readFile('manifest.json', 'utf8')).version;
}

function revisionVersions(revision) {
    return (revision?.distributionChannels || []).map(c => c.crxVersion).filter(Boolean);
}

function describe(revision) {
    if (!revision) return 'none';
    const versions = revisionVersions(revision);
    return `${versions.join(', ') || 'unknown version'} (${revision.state})`;
}

async function status(requireNewer) {
    const s = await call('GET', `/v2/${itemName}:fetchStatus`);
    const local = await manifestVersion();
    console.log(`::notice::Store access OK. Published: ${describe(s.publishedItemRevisionStatus)}. Submitted: ${describe(s.submittedItemRevisionStatus)}. manifest.json: ${local}.`);
    if (s.takenDown) console.log('::warning::The item is taken down in the Chrome Web Store.');
    if (s.warned) console.log('::warning::The item has a policy warning in the Chrome Web Store.');

    const submitted = s.submittedItemRevisionStatus;
    if (requireNewer && submitted?.state === 'PENDING_REVIEW') {
        fail(`Version ${describe(submitted)} is still in review. The store accepts no new submission until that review finishes; re-run this job afterwards.`);
    }

    const storeVersions = [
        ...revisionVersions(s.publishedItemRevisionStatus),
        ...revisionVersions(s.submittedItemRevisionStatus)
    ];
    const highest = storeVersions.sort(compareVersions).at(-1);
    if (highest && compareVersions(local, highest) <= 0) {
        const message = `manifest.json version ${local} must be higher than the store's ${highest}.`;
        if (requireNewer) fail(message);
        console.log(`::warning::${message}`);
    }
}

async function upload(zipPath) {
    if (!zipPath) fail('upload needs the path of the zip');
    const zip = await readFile(zipPath);
    const result = await call('POST', `/upload/v2/${itemName}:upload?uploadType=media`, {
        body: zip,
        contentType: 'application/zip'
    });
    let state = result.uploadState;
    for (let i = 0; state === 'IN_PROGRESS' && i < POLL_ATTEMPTS; i++) {
        await new Promise(r => setTimeout(r, POLL_MS));
        state = (await call('GET', `/v2/${itemName}:fetchStatus`)).lastAsyncUploadState;
    }
    if (state !== 'SUCCEEDED') fail(`Upload did not succeed (state: ${state}).`);
    console.log(`::notice::Uploaded ${result.crxVersion ? `version ${result.crxVersion}` : zipPath}.`);
}

async function publish() {
    const result = await call('POST', `/v2/${itemName}:publish`, {
        body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
        contentType: 'application/json'
    });
    if (!PUBLISHED_STATES.has(result.state)) fail(`Publish returned state ${result.state}.`);
    if (result.warningInfo) console.log(`::warning::Publish warnings: ${JSON.stringify(result.warningInfo)}`);
    console.log(`::notice::Submitted for publishing (state: ${result.state}).`);
}

const BREAKDOWNS = ['install-source', 'install-type', 'country', 'app-version', 'os'];

function isoDate({ year, month, day }) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function queryMetrics(metricNames, days, dimension) {
    const last = new Date();
    const first = new Date(last.getTime() - (days - 1) * 86400000);
    const params = new URLSearchParams({ pageSize: '1000' });
    for (const m of metricNames) params.append('metrics', m);
    if (dimension) params.append('dimensions', dimension);
    for (const [key, d] of [['firstDate', first], ['lastDate', last]]) {
        params.set(`timeSpec.${key}.year`, d.getUTCFullYear());
        params.set(`timeSpec.${key}.month`, d.getUTCMonth() + 1);
        params.set(`timeSpec.${key}.day`, d.getUTCDate());
    }
    const rows = [];
    let pageToken;
    do {
        if (pageToken) params.set('pageToken', pageToken);
        const page = await call('GET', `/v2/${itemName}:queryMetrics?${params}`);
        rows.push(...(page.metricRows || []));
        pageToken = page.nextPageToken;
    } while (pageToken);
    return rows;
}

function metricOf(row, name) {
    const m = (row.metricValues || []).find(v => v.metric === name);
    return { value: Number(m?.value || 0), unique: m?.uniqueUserCount === undefined ? null : Number(m.uniqueUserCount) };
}

async function metrics(daysArg) {
    const days = Number(daysArg) || 60;
    const daily = await queryMetrics(['installs', 'uninstalls', 'users', 'page-views'], days);
    console.log(`Daily metrics, last ${days} days (installs: total / unique users)`);
    console.log('date        installs  unique  uninstalls  active-users  page-views');
    const totals = { installs: 0, unique: 0, uninstalls: 0 };
    for (const row of daily.filter(r => r.date).sort((a, b) => isoDate(a.date).localeCompare(isoDate(b.date)))) {
        const installs = metricOf(row, 'installs');
        const uninstalls = metricOf(row, 'uninstalls').value;
        totals.installs += installs.value;
        totals.unique += installs.unique ?? 0;
        totals.uninstalls += uninstalls;
        console.log([
            isoDate(row.date),
            String(installs.value).padStart(8),
            String(installs.unique ?? '-').padStart(7),
            String(uninstalls).padStart(11),
            String(metricOf(row, 'users').value).padStart(13),
            String(metricOf(row, 'page-views').value).padStart(11)
        ].join(' '));
    }
    console.log(`Totals: ${totals.installs} installs (${totals.unique} unique users), ${totals.uninstalls} uninstalls.`);

    for (const dimension of BREAKDOWNS) {
        const rows = await queryMetrics(['installs'], days, dimension);
        const byValue = new Map();
        for (const row of rows) {
            const key = (row.dimensionValues || []).join(' / ') || '(none)';
            byValue.set(key, (byValue.get(key) || 0) + metricOf(row, 'installs').value);
        }
        const sorted = [...byValue].sort((a, b) => b[1] - a[1]).slice(0, 15);
        console.log(`\nInstalls by ${dimension}:`);
        for (const [key, count] of sorted) console.log(`  ${String(count).padStart(6)}  ${key}`);
    }
}

const [command, arg] = process.argv.slice(2);
switch (command) {
    case 'status': await status(arg === '--require-newer'); break;
    case 'upload': await upload(arg); break;
    case 'publish': await publish(); break;
    case 'metrics': await metrics(arg); break;
    default: fail(`Unknown command "${command}". Use status, upload, publish or metrics.`);
}
