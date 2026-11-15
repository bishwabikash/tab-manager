#!/usr/bin/env node
// Chrome Web Store API v2 client for CI.
// Usage: cws.mjs status [--require-newer] | upload <zip> | publish
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

const [command, arg] = process.argv.slice(2);
switch (command) {
    case 'status': await status(arg === '--require-newer'); break;
    case 'upload': await upload(arg); break;
    case 'publish': await publish(); break;
    default: fail(`Unknown command "${command}". Use status, upload or publish.`);
}
