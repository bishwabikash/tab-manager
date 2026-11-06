const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor } = require('./helpers');

let h;
beforeEach(async () => { h = await launch(); });
afterEach(async () => { await h.close(); });

const HOSTILE_TITLE = `Evil" onmouseover="window.__pwned=1" data-injected="<img src=x onerror=alert(1)> 'q'`;

test('popup renders hostile tab titles as text without injecting attributes', async () => {
    await h.open(h.url('alpha.test', '/evil', HOSTILE_TITLE));
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('.tab-item');

    const items = await popup.$$eval('.tab-item', els => els.map(e => ({
        title: e.getAttribute('title'),
        attrs: e.getAttributeNames(),
        text: e.querySelector('.tab-title').textContent,
        imgs: e.querySelectorAll('.tab-title img').length
    })));
    const evil = items.find(i => i.text === HOSTILE_TITLE);
    assert.ok(evil, `hostile title rendered verbatim: ${JSON.stringify(items)}`);
    assert.equal(evil.title, HOSTILE_TITLE);
    assert.deepEqual(evil.attrs.sort(), ['class', 'data-tab-id', 'role', 'tabindex', 'title']);
    assert.equal(evil.imgs, 0);
});

test('search highlights matches without corrupting HTML entities', async () => {
    await h.open(h.url('alpha.test', '/1', 'Tom & Jerry <3'));
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('.tab-item');

    await popup.fill('#searchInput', 'amp');
    await popup.waitForSelector('.no-results');

    await popup.fill('#searchInput', '&');
    await popup.waitForSelector('.search-highlight');
    const title = await popup.$eval('.tab-title', e => e.textContent);
    const highlights = await popup.$$eval('.search-highlight', els => els.map(e => e.textContent));
    assert.equal(title, 'Tom & Jerry <3');
    assert.deepEqual(highlights, ['&']);

    await popup.fill('#searchInput', 'lt');
    await popup.waitForSelector('.no-results');
});

test('popup "Close All" duplicates never closes pinned tabs', async () => {
    const url = h.url('alpha.test', '/dup');
    const pinnedPage = await h.open(url);
    await h.open(url);
    await h.open(url);
    const windowId = await h.windowId();
    await h.sw.evaluate(async ({ w, u }) => {
        const tabs = await chrome.tabs.query({ windowId: w });
        await chrome.tabs.update(tabs.find(t => t.url === u).id, { pinned: true });
    }, { w: windowId, u: url });
    void pinnedPage;

    const popup = await h.open(h.extUrl('popup.html'));
    await popup.click('#findDuplicatesBtn');
    await popup.waitForSelector('#duplicatesSection', { state: 'visible' });
    assert.equal(await popup.textContent('#duplicateCount'), '1');
    assert.equal(await popup.textContent('.duplicate-badge'), '2×');

    await popup.click('#closeDuplicatesBtn');

    await waitFor(async () => (await h.tabs(windowId)).filter(t => t.url === url).length === 2,
        { message: 'one unpinned duplicate closed' });
    const remaining = (await h.tabs(windowId)).filter(t => t.url === url);
    assert.equal(remaining.filter(t => t.pinned).length, 1);
});

test('options page does not overwrite settings changed elsewhere', async () => {
    await h.setSettings({ autoGroup: false, theme: 'dark' });
    const options = await h.open(h.extUrl('options.html'));
    assert.equal(await options.isChecked('#autoGroup'), false);

    await h.setSettings({ autoGroup: true, theme: 'dark' });
    await waitFor(() => options.isChecked('#autoGroup'), { message: 'options toggle to refresh' });
    await options.click('#themeLight');

    await waitFor(async () => (await h.getSettings()).theme === 'light', { message: 'theme saved' });
    assert.equal((await h.getSettings()).autoGroup, true);
});

test('popup is keyboard operable: group headers, tab rows and auto-group switch', async () => {
    await h.setSettings({ autoGroup: false });
    await h.open(h.url('alpha.test', '/1'));
    const target = await h.open(h.url('alpha.test', '/2'));
    void target;
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('.tab-item');

    const header = popup.locator('.domain-header').first();
    await header.focus();
    await popup.keyboard.press('Enter');
    assert.equal(await header.getAttribute('aria-expanded'), 'false');
    await popup.keyboard.press(' ');
    assert.equal(await header.getAttribute('aria-expanded'), 'true');

    await popup.locator('#autoGroupToggle').focus();
    await popup.keyboard.press(' ');
    await waitFor(async () => (await h.getSettings()).autoGroup === true, { message: 'auto-group enabled by keyboard' });

    const windowId = await h.windowId();
    const firstAlpha = (await h.tabs(windowId)).find(t => t.url.includes('/1'));
    await popup.locator(`.tab-item[data-tab-id="${firstAlpha.id}"]`).focus();
    const closed = popup.waitForEvent('close');
    await popup.keyboard.press('Enter').catch(() => { });
    await closed;
    await waitFor(async () => (await h.tabs(windowId)).find(t => t.id === firstAlpha.id)?.active,
        { message: 'Enter switches to tab' });
});

test('footer shows the actual configured shortcuts', async () => {
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('.domain-list');
    const commands = await popup.evaluate(() => chrome.commands.getAll());
    const expected = commands
        .filter(c => c.shortcut && ['group-all-tabs', 'ungroup-all-tabs'].includes(c.name))
        .map(c => c.shortcut);
    const footer = popup.locator('#shortcuts');
    await waitFor(async () => (await footer.isHidden()) === (expected.length === 0), { message: 'footer state' });
    const text = await footer.textContent();
    for (const shortcut of expected) assert.ok(text.includes(shortcut), `${text} lacks ${shortcut}`);
    if (expected.length) assert.ok(!text.includes('undefined'));
});

test('duplicates panel stays accurate and its button label is stable', async () => {
    const url = h.url('alpha.test', '/dup');
    await h.open(url);
    await h.open(url);
    await h.open(h.url('beta.test', '/b'));
    await h.open(h.url('beta.test', '/b'));
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.click('#findDuplicatesBtn');
    await popup.waitForSelector('#duplicatesSection', { state: 'visible' });
    assert.equal(await popup.textContent('#duplicateCount'), '2');

    const windowId = await h.windowId();
    const betaId = (await h.tabs(windowId)).find(t => t.url.includes('beta.test')).id;
    await popup.locator(`.tab-item[data-tab-id="${betaId}"]`).focus();
    await popup.keyboard.press('Tab');
    await popup.keyboard.press('Tab');
    assert.equal(await popup.evaluate(() => document.activeElement.className), 'tab-action-btn close-tab');
    await popup.keyboard.press('Enter');
    await waitFor(async () => (await popup.textContent('#duplicateCount')) === '1', { message: 'count refreshed' });

    await popup.click('#closeDuplicatesBtn');
    await popup.waitForSelector('#duplicatesSection', { state: 'hidden' });
    assert.equal((await popup.textContent('#closeDuplicatesBtn')).trim(), 'Close All');
});

test('no-results message preserves the query as typed', async () => {
    await h.open(h.url('alpha.test'));
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('.tab-item');
    await popup.fill('#searchInput', 'AT&T Zzz');
    assert.equal(await popup.textContent('.no-results p'), 'No tabs match "AT&T Zzz"');
});
