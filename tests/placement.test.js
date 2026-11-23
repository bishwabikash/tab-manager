const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor, sleep } = require('./helpers');

let h;
beforeEach(async () => { h = await launch(); });
afterEach(async () => {
    assert.deepEqual(h.swErrors, [], 'service worker logged errors');
    await h.close();
});

async function makeProjectGroup() {
    const boardUrl = h.url('jira.test', '/board', 'Project X board');
    await h.open(boardUrl);
    const windowId = await h.windowId();
    const groupId = await h.sw.evaluate(async ({ w, u }) => {
        const tab = (await chrome.tabs.query({ windowId: w })).find(t => t.url === u);
        const id = await chrome.tabs.group({ tabIds: [tab.id] });
        await chrome.tabGroups.update(id, { title: 'Project X' });
        return id;
    }, { w: windowId, u: boardUrl });
    return { windowId, groupId };
}

// Ctrl+T then Enter in the address bar: a New Tab page that then navigates.
async function openFromAddressBar(url) {
    const tabId = await h.sw.evaluate(async () => (await chrome.tabs.create({})).id);
    await sleep(300);
    await h.sw.evaluate(({ id, u }) => chrome.tabs.update(id, { url: u }), { id: tabId, u: url });
    await waitFor(async () => (await h.sw.evaluate(id => chrome.tabs.get(id), tabId)).status === 'complete',
        { message: 'address-bar tab loaded' });
    return tabId;
}

async function runAllGroupingPaths(windowId) {
    await h.groupWindow(windowId);
    await h.sw.evaluate(() => runPeriodicCheck());
    await sleep(2000);
}

const tabGroupId = (tabId) => h.sw.evaluate(async id => (await chrome.tabs.get(id)).groupId, tabId);

async function choose(label) {
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('#placementSection:not([hidden])');
    const options = await popup.$$eval('.placement-option', els => els.map(e => e.textContent.trim()));
    assert.equal(await popup.isHidden('.tabs-section'), true, 'only the picker is shown while asking');
    const closed = popup.waitForEvent('close');
    await popup.click(`.placement-option:text-is("${label}")`).catch(() => { });
    await closed;
    return options;
}

test('a tab opened from the address bar waits ungrouped and the picker puts it in the chosen group', async () => {
    await h.setSettings({ autoGroup: true, groupSingleTabs: true, askForAddressBarTabs: true });
    const { windowId, groupId } = await makeProjectGroup();

    const tabId = await openFromAddressBar(h.url('docs.test', '/spec', 'Project X spec'));
    await runAllGroupingPaths(windowId);
    assert.equal(await tabGroupId(tabId), -1, 'held back from auto-grouping while waiting');
    assert.equal(await h.sw.evaluate(id => chrome.action.getBadgeText({ tabId: id }), tabId), '?');

    const options = await choose('Project X');
    assert.deepEqual(options, ['Project X', 'Group by site (Docs)', 'Keep ungrouped']);
    await waitFor(async () => (await tabGroupId(tabId)) === groupId, { message: 'tab moved into Project X' });

    await runAllGroupingPaths(windowId);
    assert.equal(await tabGroupId(tabId), groupId, 'stays in the chosen group');
    assert.notEqual(await h.sw.evaluate(id => chrome.action.getBadgeText({ tabId: id }), tabId), '?');
});

test('"Group by site" groups the tab by its site even when single-tab groups are off', async () => {
    await h.setSettings({ autoGroup: true, groupSingleTabs: false, askForAddressBarTabs: true });
    await makeProjectGroup();
    const tabId = await openFromAddressBar(h.url('docs.test', '/spec', 'Spec'));

    await choose('Group by site (Docs)');

    await waitFor(async () => (await tabGroupId(tabId)) !== -1, { message: 'tab grouped' });
    const group = await h.sw.evaluate(async id => chrome.tabGroups.get((await chrome.tabs.get(id)).groupId), tabId);
    await waitFor(async () => (await h.sw.evaluate(g => chrome.tabGroups.get(g), group.id)).title === 'Docs', { message: 'Docs title' });
});

test('"Keep ungrouped" keeps the tab out of auto-grouping', async () => {
    await h.setSettings({ autoGroup: true, groupSingleTabs: true, askForAddressBarTabs: true });
    const { windowId } = await makeProjectGroup();
    const tabId = await openFromAddressBar(h.url('docs.test', '/spec', 'Spec'));

    await choose('Keep ungrouped');
    await runAllGroupingPaths(windowId);

    assert.equal(await tabGroupId(tabId), -1);
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('.tab-item');
    assert.equal(await popup.isHidden('#placementSection'), true, 'no picker once answered');
});

test('with the setting off, address-bar tabs are grouped by site as before', async () => {
    await h.setSettings({ autoGroup: true, groupSingleTabs: true, askForAddressBarTabs: false });
    const { windowId } = await makeProjectGroup();
    const tabId = await openFromAddressBar(h.url('docs.test', '/spec', 'Spec'));
    await runAllGroupingPaths(windowId);

    const group = await h.sw.evaluate(async id => {
        const t = await chrome.tabs.get(id);
        return t.groupId === -1 ? null : chrome.tabGroups.get(t.groupId);
    }, tabId);
    assert.equal(group?.title, 'Docs');
});

test('tabs opened from links are not held for a choice', async () => {
    await h.setSettings({ autoGroup: true, groupSingleTabs: true, askForAddressBarTabs: true });
    const { windowId } = await makeProjectGroup();
    const page = await h.open(h.url('news.test', '/front', 'Front page'));
    await page.evaluate(u => { document.body.innerHTML = `<a id="l" href="${u}" target="_blank">x</a>`; }, h.url('docs.test', '/linked', 'Linked'));
    await page.click('#l');
    await waitFor(async () => (await h.tabs(windowId)).some(t => t.url.includes('/linked?') && t.status === 'complete'), { message: 'link tab' });
    await runAllGroupingPaths(windowId);

    const linked = (await h.tabs(windowId)).find(t => t.url.includes('/linked?'));
    assert.notEqual(linked.groupId, -1, 'grouped normally');
    const popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('.tab-item');
    assert.equal(await popup.isHidden('#placementSection'), true);
});
