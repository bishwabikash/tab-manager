const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { EXTENSION_PATH } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(EXTENSION_PATH, f), 'utf8');

function zippedPaths() {
    const workflow = read('.github/workflows/publish.yml');
    const command = workflow.match(/zip -r extension\.zip([\s\S]*?)\n\s*\n/)[1];
    return command.split(/\s+/).map(s => s.replace(/\\$/, '')).filter(Boolean);
}

function referencedFiles() {
    const manifest = JSON.parse(read('manifest.json'));
    const files = new Set([
        manifest.background.service_worker,
        manifest.action.default_popup,
        manifest.options_ui.page,
        ...Object.values(manifest.icons),
        ...Object.values(manifest.action.default_icon)
    ]);
    for (const js of fs.readdirSync(EXTENSION_PATH).filter(f => f.endsWith('.js'))) {
        for (const [, page] of read(js).matchAll(/getURL\('([^']+)'\)/g)) files.add(page);
    }
    for (const html of [...files].filter(f => f.endsWith('.html'))) {
        for (const [, ref] of read(html).matchAll(/(?:src|href)="([^":]+)"/g)) files.add(ref);
    }
    return [...files];
}

test('store zip includes every file the extension references', () => {
    const zipped = zippedPaths();
    const included = (file) => zipped.some(entry => entry === file || (entry.endsWith('/') && file.startsWith(entry)));
    const missing = referencedFiles().filter(f => !included(f));
    assert.deepEqual(missing, []);
});

function makeRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-manager-release-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '9.9.9' }));
    git('add', '.');
    git('commit', '-q', '-m', 'init', '--no-verify');
    return { dir, git };
}

test('release tag check accepts only v<manifest version> on main', () => {
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-manager-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    const { dir, git } = makeRepo();
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '1.6.0' }));
    git('commit', '-qam', 'bump', '--no-verify');
    git('remote', 'add', 'origin', remote);
    git('push', '-q', 'origin', 'main');

    const verify = (tag) => spawnSync('bash', [path.join(EXTENSION_PATH, '.github/scripts/verify-release-tag.sh')], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_REF_NAME: tag }
    });

    const ok = verify('v1.6.0');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);

    const mismatched = verify('v1.7.0');
    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stdout, /does not match manifest\.json version 1\.6\.0/);

    git('checkout', '-q', '-b', 'feature');
    git('commit', '-q', '--allow-empty', '-m', 'unmerged', '--no-verify');
    const offMain = verify('v1.6.0');
    assert.equal(offMain.status, 1);
    assert.match(offMain.stdout, /not on main/);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
});

test('release-please updates every version field and they agree today', () => {
    const config = JSON.parse(read('release-please-config.json'));
    const extraFiles = config.packages['.']['extra-files'];
    assert.deepEqual(extraFiles, [{ type: 'json', path: 'manifest.json', jsonpath: '$.version' }]);
    assert.equal(config.packages['.']['release-type'], 'node');

    const versions = {
        manifest: JSON.parse(read('manifest.json')).version,
        packageJson: JSON.parse(read('package.json')).version,
        packageLock: JSON.parse(read('package-lock.json')).version,
        releasePlease: JSON.parse(read('.release-please-manifest.json'))['.']
    };
    assert.equal(new Set(Object.values(versions)).size, 1, JSON.stringify(versions));
});

test('PR title check accepts Conventional Commits and rejects the rest', () => {
    const check = (title) => spawnSync('bash', [path.join(EXTENSION_PATH, '.github/scripts/check-pr-title.sh'), title], { encoding: 'utf8' });
    for (const ok of ['fix: keep pinned tabs', 'feat(popup): keyboard access', 'feat!: new storage format', 'chore(main): release 1.7.0']) {
        assert.equal(check(ok).status, 0, ok);
    }
    for (const bad of ['Fix pinned tabs', 'feature: thing', 'fix:no space', 'fix: ', '$(touch /tmp/pwned)']) {
        const result = check(bad);
        assert.equal(result.status, 1, bad);
        assert.match(result.stdout, /must look like/);
    }
});

test('the store package, built exactly as the publish workflow builds it, loads in Chrome', async () => {
    const { chromium } = require('playwright');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-manager-package-'));
    const zip = path.join(work, 'extension.zip');
    const unpacked = path.join(work, 'unpacked');
    execFileSync('zip', ['-qr', zip, ...zippedPaths()], { cwd: EXTENSION_PATH });
    execFileSync('unzip', ['-q', zip, '-d', unpacked]);

    const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`]
    });
    try {
        let [sw] = context.serviceWorkers();
        if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
        const extensionId = new URL(sw.url()).host;
        const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
        assert.equal(manifest.version, JSON.parse(read('manifest.json')).version);

        for (const [page, selector] of [['options.html', '#autoGroup'], ['popup.html', '#domainList'], ['welcome.html', '#enableAutoGroup']]) {
            const tab = await context.newPage();
            const response = await tab.goto(`chrome-extension://${extensionId}/${page}`);
            assert.ok(response.ok(), `${page} did not load`);
            await tab.waitForSelector(selector, { timeout: 5000 });
            await tab.close();
        }
    } finally {
        await context.close();
        fs.rmSync(work, { recursive: true, force: true });
    }
});
