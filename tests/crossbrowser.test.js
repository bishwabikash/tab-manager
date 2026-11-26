const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { EXTENSION_PATH } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(EXTENSION_PATH, f), 'utf8');
const manifest = () => JSON.parse(read('manifest.json'));

function chromeZippedFiles() {
    const command = read('.github/workflows/publish.yml')
        .match(/zip -r extension\.zip([\s\S]*?)\n\s*\n/)[1];
    return command.split(/\s+/).map(s => s.replace(/\\$/, '')).filter(Boolean)
        .flatMap(p => p.endsWith('/')
            ? fs.readdirSync(path.join(EXTENSION_PATH, p)).map(f => p + f)
            : [p])
        .sort();
}

test('the manifest declares a background entry point for both browsers', () => {
    const { background } = manifest();
    assert.equal(background.service_worker, 'background.js', 'Chrome needs service_worker');
    assert.deepEqual(background.scripts, ['background.js'], 'Firefox needs scripts');
});

test('gecko settings satisfy what AMO requires to sign and list', () => {
    const gecko = manifest().browser_specific_settings?.gecko;
    assert.ok(gecko, 'browser_specific_settings.gecko is required to sign MV3 on AMO');
    assert.match(gecko.id, /^[a-zA-Z0-9\-._]*@[a-zA-Z0-9\-._]+$/, 'id must look like an email');

    // tabGroups needs 139; data_collection_permissions needs 140 (Android 142).
    assert.ok(parseFloat(gecko.strict_min_version) >= 140,
        `strict_min_version ${gecko.strict_min_version} is below the 140 needed for data_collection_permissions`);

    // Mandatory for new AMO submissions since 2025-11-03. Nothing leaves the device.
    assert.deepEqual(gecko.data_collection_permissions?.required, ['none']);

    // Firefox for Android only gained data_collection_permissions in 142.
    const android = manifest().browser_specific_settings?.gecko_android;
    assert.ok(parseFloat(android?.strict_min_version) >= 142,
        `gecko_android.strict_min_version ${android?.strict_min_version} is below 142`);
});

test('requestUpdateCheck is guarded, since Firefox does not implement it', () => {
    const source = read('background.js');
    assert.match(source, /const UPDATE_CHECK_SUPPORTED = typeof chrome\.runtime\.requestUpdateCheck === 'function'/);
    const guards = source.match(/UPDATE_CHECK_SUPPORTED/g) ?? [];
    assert.ok(guards.length >= 3, `expected the definition plus a guard in each caller, found ${guards.length}`);
    assert.match(read('options.js'), /UPDATE_CHECK_SUPPORTED/, 'the options page must hide the button it cannot use');
});

test('the Firefox package ships exactly the files the Chrome zip ships', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-manager-firefox-'));
    try {
        execFileSync('npx', ['web-ext', 'build', '--source-dir', EXTENSION_PATH,
            '--artifacts-dir', out, '--overwrite-dest'], { cwd: EXTENSION_PATH, stdio: 'pipe' });
        const zip = path.join(out, fs.readdirSync(out).find(f => f.endsWith('.zip')));
        const packaged = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
            .trim().split('\n').filter(f => !f.endsWith('/')).sort();
        assert.deepEqual(packaged, chromeZippedFiles(),
            'the two store packages have drifted apart');
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
});

test('web-ext lint reports no errors against the Firefox build', () => {
    let raw;
    try {
        raw = execFileSync('npx', ['web-ext', 'lint', '--source-dir', EXTENSION_PATH, '--output', 'json'],
            { cwd: EXTENSION_PATH, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        raw = e.stdout ?? '';
    }
    const report = JSON.parse(raw.slice(raw.indexOf('{')));
    assert.deepEqual(report.errors, [], `web-ext lint errors: ${JSON.stringify(report.errors)}`);
});
