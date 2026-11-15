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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-manager-hooks-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '9.9.9' }));
    git('add', '.');
    git('commit', '-q', '-m', 'init', '--no-verify');
    return { dir, git };
}

const runHook = (dir, hook) =>
    spawnSync('bash', [path.join(EXTENSION_PATH, '.githooks', hook)], { cwd: dir, encoding: 'utf8' });

test('pre-commit hook does not block commits when the remote is unreachable', () => {
    const { dir, git } = makeRepo();
    git('remote', 'add', 'origin', path.join(dir, 'does-not-exist'));
    const result = runHook(dir, 'pre-commit');
    assert.equal(result.status, 0, result.stderr);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('post-commit hook only tags and pushes from main', () => {
    const { dir, git } = makeRepo();
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-manager-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    git('remote', 'add', 'origin', remote);

    git('checkout', '-q', '-b', 'feature');
    assert.equal(runHook(dir, 'post-commit').status, 0);
    assert.equal(git('tag'), '');

    git('checkout', '-q', 'main');
    const onMain = runHook(dir, 'post-commit');
    assert.equal(onMain.status, 0, onMain.stderr);
    assert.equal(git('tag'), 'v9.9.9');
    assert.match(execFileSync('git', ['tag'], { cwd: remote, encoding: 'utf8' }), /v9\.9\.9/);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
});

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
