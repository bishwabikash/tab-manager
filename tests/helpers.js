const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXTENSION_PATH = path.resolve(__dirname, '..');

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function waitFor(fn, { timeout = 8000, interval = 100, message = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        last = await fn();
        if (last) return last;
        await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Timed out waiting for ${message} (last value: ${JSON.stringify(last)})`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Launch Chromium with the unpacked extension. Any hostname resolves to a
 * local server, so `http://alpha.test:PORT/x` is a real page on domain "Alpha".
 * Pages accept ?title=... to control the tab title.
 */
async function launch() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://local');
        const title = url.searchParams.get('title') ?? `Page ${url.pathname}`;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><title>${escapeHtml(title)}</title><p>${escapeHtml(url.pathname)}</p>`);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-manager-test-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--host-resolver-rules=MAP * 127.0.0.1',
            '--no-proxy-server'
        ]
    });

    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = new URL(sw.url()).host;
    const swErrors = [];
    sw.on('console', msg => { if (msg.type() === 'error') swErrors.push(msg.text()); });

    const welcome = await waitFor(() => context.pages().find(p => p.url().includes('welcome.html')),
        { message: 'welcome page on install' });
    await welcome.close();

    const h = {
        context,
        sw,
        extensionId,
        swErrors,
        url: (host, pathname = '/', title) =>
            `http://${host}:${port}${pathname}${title === undefined ? '' : `?title=${encodeURIComponent(title)}`}`,
        extUrl: (page) => `chrome-extension://${extensionId}/${page}`,
        async open(url) {
            const page = await context.newPage();
            await page.goto(url);
            return page;
        },
        setSettings: (settings) => sw.evaluate(async (s) => {
            await chrome.storage.local.set({
                tabManagerSettings: {
                    autoGroup: false, collapseByDefault: false, groupSingleTabs: false,
                    autoCloseDuplicates: false, theme: 'dark', ...s
                }
            });
        }, settings),
        getSettings: () => sw.evaluate(async () => (await chrome.storage.local.get('tabManagerSettings')).tabManagerSettings),
        windowId: () => sw.evaluate(async () => (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id),
        tabs: (windowId) => sw.evaluate((w) => chrome.tabs.query(w ? { windowId: w } : {}), windowId),
        groups: (windowId) => sw.evaluate((w) => chrome.tabGroups.query(w ? { windowId: w } : {}), windowId),
        groupWindow: (windowId) => sw.evaluate((w) => groupTabsByDomain(w), windowId),
        async groupedTitles(windowId) {
            const groups = await h.groups(windowId);
            return groups.map(g => g.title).sort();
        },
        async close() {
            await context.close();
            server.close();
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
    };
    return h;
}

module.exports = { launch, waitFor, sleep, EXTENSION_PATH };
