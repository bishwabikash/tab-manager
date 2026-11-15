const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EXTENSION_PATH } = require('./helpers');

const SCRIPT = path.join(EXTENSION_PATH, '.github/scripts/cws.mjs');
const ITEM = '/v2/publishers/pub1/items/ext1';

// Stands in for chromewebstore.googleapis.com; routes match the v2 discovery document.
async function fakeStore(routes) {
    const requests = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const key = `${req.method} ${req.url}`;
            requests.push({ key, headers: req.headers, body: Buffer.concat(chunks) });
            const handler = routes[key];
            const [status, body] = typeof handler === 'function' ? handler() : handler || [404, { error: { message: 'no route' } }];
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { base: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

function run(store, args, { manifestVersion = '1.5.1', env = {} } = {}) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cws-test-'));
    fs.writeFileSync(path.join(cwd, 'manifest.json'), JSON.stringify({ version: manifestVersion }));
    fs.writeFileSync(path.join(cwd, 'extension.zip'), 'PK-zip-bytes');
    return new Promise(resolve => {
        const child = spawn(process.execPath, [SCRIPT, ...args], {
            cwd,
            env: {
                PATH: process.env.PATH,
                ACCESS_TOKEN: 'tok', CWS_PUBLISHER_ID: 'pub1', CWS_EXTENSION_ID: 'ext1',
                CWS_API_BASE: store.base, CWS_POLL_MS: '10', ...env
            }
        });
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });
        child.on('close', code => { fs.rmSync(cwd, { recursive: true, force: true }); resolve({ code, out }); });
    });
}

const published = (version, state = 'PUBLISHED') => ({ state, distributionChannels: [{ crxVersion: version, deployPercentage: 100 }] });

test('status reports store and manifest versions with the bearer token', async () => {
    const store = await fakeStore({ [`GET ${ITEM}:fetchStatus`]: [200, { publishedItemRevisionStatus: published('1.5.0') }] });
    const { code, out } = await run(store, ['status']);
    store.close();
    assert.equal(code, 0, out);
    assert.match(out, /Published: 1\.5\.0 \(PUBLISHED\)\. Submitted: none\. manifest\.json: 1\.5\.1/);
    assert.equal(store.requests[0].headers.authorization, 'Bearer tok');
});

test('status --require-newer fails when manifest is not above the highest store version', async () => {
    const store = await fakeStore({
        [`GET ${ITEM}:fetchStatus`]: [200, {
            publishedItemRevisionStatus: published('1.9.0'),
            submittedItemRevisionStatus: published('1.10.0', 'STAGED')
        }]
    });
    const warn = await run(store, ['status'], { manifestVersion: '1.9.5' });
    const strict = await run(store, ['status', '--require-newer'], { manifestVersion: '1.9.5' });
    const ok = await run(store, ['status', '--require-newer'], { manifestVersion: '1.10.1' });
    store.close();
    assert.equal(warn.code, 0);
    assert.match(warn.out, /::warning::manifest\.json version 1\.9\.5 must be higher than the store's 1\.10\.0/);
    assert.equal(strict.code, 1);
    assert.equal(ok.code, 0, ok.out);
});

test('status --require-newer stops while an earlier version is still in review', async () => {
    const store = await fakeStore({
        [`GET ${ITEM}:fetchStatus`]: [200, {
            publishedItemRevisionStatus: published('1.5.0'),
            submittedItemRevisionStatus: published('1.6.0', 'PENDING_REVIEW')
        }]
    });
    const strict = await run(store, ['status', '--require-newer'], { manifestVersion: '1.7.0' });
    const relaxed = await run(store, ['status'], { manifestVersion: '1.7.0' });
    store.close();
    assert.equal(strict.code, 1);
    assert.match(strict.out, /Version 1\.6\.0 \(PENDING_REVIEW\) is still in review/);
    assert.equal(relaxed.code, 0, relaxed.out);
});

test('upload sends the zip and accepts an immediate success', async () => {
    const store = await fakeStore({
        [`POST /upload${ITEM}:upload?uploadType=media`]: [200, { uploadState: 'SUCCEEDED', crxVersion: '1.5.1' }]
    });
    const { code, out } = await run(store, ['upload', 'extension.zip']);
    store.close();
    assert.equal(code, 0, out);
    assert.match(out, /Uploaded version 1\.5\.1/);
    assert.equal(store.requests[0].headers['content-type'], 'application/zip');
    assert.equal(store.requests[0].body.toString(), 'PK-zip-bytes');
});

test('upload polls fetchStatus while processing, and fails on a failed upload', async () => {
    let polls = 0;
    const pending = await fakeStore({
        [`POST /upload${ITEM}:upload?uploadType=media`]: [200, { uploadState: 'IN_PROGRESS' }],
        [`GET ${ITEM}:fetchStatus`]: () => [200, { lastAsyncUploadState: ++polls < 3 ? 'IN_PROGRESS' : 'SUCCEEDED' }]
    });
    const ok = await run(pending, ['upload', 'extension.zip']);
    pending.close();
    assert.equal(ok.code, 0, ok.out);
    assert.equal(polls, 3);

    const failing = await fakeStore({ [`POST /upload${ITEM}:upload?uploadType=media`]: [200, { uploadState: 'FAILED' }] });
    const bad = await run(failing, ['upload', 'extension.zip']);
    failing.close();
    assert.equal(bad.code, 1);
    assert.match(bad.out, /Upload did not succeed \(state: FAILED\)/);
});

test('publish submits a default publish and accepts pending review', async () => {
    const store = await fakeStore({ [`POST ${ITEM}:publish`]: [200, { state: 'PENDING_REVIEW' }] });
    const { code, out } = await run(store, ['publish']);
    store.close();
    assert.equal(code, 0, out);
    assert.deepEqual(JSON.parse(store.requests[0].body), { publishType: 'DEFAULT_PUBLISH' });
    assert.match(out, /Submitted for publishing \(state: PENDING_REVIEW\)/);
});

test('API errors are reported with Google\'s message and an access hint', async () => {
    const store = await fakeStore({
        [`POST ${ITEM}:publish`]: [403, { error: { code: 403, message: 'The caller does not have permission' } }]
    });
    const { code, out } = await run(store, ['publish']);
    store.close();
    assert.equal(code, 1);
    assert.match(out, /HTTP 403: The caller does not have permission\. Check that the service account is added/);
});

test('missing configuration fails before any request', async () => {
    const store = await fakeStore({});
    const { code, out } = await run(store, ['status'], { env: { CWS_PUBLISHER_ID: '' } });
    store.close();
    assert.equal(code, 1);
    assert.match(out, /CWS_PUBLISHER_ID is not set/);
    assert.equal(store.requests.length, 0);
});
