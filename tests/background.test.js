const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor, sleep } = require('./helpers');

let h;
beforeEach(async () => { h = await launch(); });
afterEach(async () => {
    assert.deepEqual(h.swErrors, [], 'service worker logged errors');
    await h.close();
});

test('groups multi-tab domains and skips single-tab domains when groupSingleTabs is off', async () => {
    await h.setSettings({ groupSingleTabs: false });
    await h.open(h.url('alpha.test', '/1'));
    await h.open(h.url('alpha.test', '/2'));
    await h.open(h.url('beta.test', '/1'));
    const windowId = await h.windowId();

    const result = await h.groupWindow(windowId);

    assert.equal(result.success, true);
    await waitFor(async () => (await h.groupedTitles(windowId)).join() === 'Alpha', { message: 'Alpha group titled' });
    const beta = (await h.tabs(windowId)).find(t => t.url.includes('beta.test'));
    assert.equal(beta.groupId, -1);
});

test('groups single-tab domains when groupSingleTabs is on', async () => {
    await h.setSettings({ groupSingleTabs: true });
    await h.open(h.url('alpha.test'));
    await h.open(h.url('beta.test'));
    const windowId = await h.windowId();

    await h.groupWindow(windowId);

    await waitFor(async () => (await h.groupedTitles(windowId)).join() === 'Alpha,Beta', { message: 'two groups' });
});

test('never groups data: or browser-internal tabs and names IP hosts by address', async () => {
    await h.setSettings({ groupSingleTabs: true });
    await h.open('data:text/html,<title>data</title>');
    await h.open('about:blank');
    await h.open(h.url('10.1.2.3', '/a'));
    const windowId = await h.windowId();

    await h.groupWindow(windowId);

    await waitFor(async () => (await h.groupedTitles(windowId)).join() === '10.1.2.3', { message: 'IP group' });
});

test('auto-group creates exactly one group per domain when tabs open concurrently', async () => {
    await h.setSettings({ autoGroup: true, groupSingleTabs: true });
    await Promise.all([1, 2, 3, 4, 5].map(i => h.open(h.url('alpha.test', `/${i}`))));
    const windowId = await h.windowId();

    await waitFor(async () => {
        const alphaTabs = (await h.tabs(windowId)).filter(t => t.url.includes('alpha.test'));
        return alphaTabs.length === 5 && alphaTabs.every(t => t.groupId !== -1);
    }, { message: 'all alpha tabs grouped' });
    await sleep(1500);

    const groups = await h.groups(windowId);
    assert.equal(groups.length, 1, `groups: ${JSON.stringify(groups.map(g => g.title))}`);
    assert.equal(groups[0].title, 'Alpha');
});

test('does not rename or empty a group the user named, with auto-group on', async () => {
    await h.setSettings({ autoGroup: false });
    await h.open(h.url('alpha.test', '/1'));
    await h.open(h.url('alpha.test', '/2'));
    const windowId = await h.windowId();
    const groupId = await h.sw.evaluate(async (w) => {
        const tabs = (await chrome.tabs.query({ windowId: w })).filter(t => t.url.includes('alpha.test'));
        const id = await chrome.tabs.group({ tabIds: tabs.map(t => t.id) });
        await chrome.tabGroups.update(id, { title: 'Work' });
        return id;
    }, windowId);

    await h.setSettings({ autoGroup: true, groupSingleTabs: true });
    await h.open(h.url('alpha.test', '/3'));
    await h.groupWindow(windowId);
    await h.sw.evaluate(() => runPeriodicCheck());
    await sleep(2500);

    const work = await h.sw.evaluate((id) => chrome.tabGroups.get(id), groupId);
    assert.equal(work.title, 'Work');
    const inWork = (await h.tabs(windowId)).filter(t => t.groupId === groupId);
    assert.equal(inWork.length, 2);
});

test('leaves user-created groups untitled when auto-group is off', async () => {
    await h.setSettings({ autoGroup: false });
    await h.open(h.url('alpha.test'));
    const windowId = await h.windowId();
    const groupId = await h.sw.evaluate(async (w) => {
        const [tab] = (await chrome.tabs.query({ windowId: w })).filter(t => t.url.includes('alpha.test'));
        return chrome.tabs.group({ tabIds: [tab.id] });
    }, windowId);

    await sleep(2500);

    const group = await h.sw.evaluate((id) => chrome.tabGroups.get(id), groupId);
    assert.equal(group.title, '');
});

test('re-titles domain groups the browser left unnamed while auto-group is on', async () => {
    await h.setSettings({ autoGroup: true });
    await h.open(h.url('alpha.test'));
    const windowId = await h.windowId();
    const groupId = await h.sw.evaluate(async (w) => {
        const [tab] = (await chrome.tabs.query({ windowId: w })).filter(t => t.url.includes('alpha.test'));
        return chrome.tabs.group({ tabIds: [tab.id] });
    }, windowId);

    await waitFor(async () => (await h.sw.evaluate((id) => chrome.tabGroups.get(id), groupId)).title === 'Alpha',
        { message: 'fixer to title group' });
});

test('badge shows the tab count of the focused window', async () => {
    await h.open(h.url('alpha.test'));
    await h.open(h.url('beta.test'));
    const windowId = await h.windowId();

    await waitFor(async () => {
        const count = (await h.tabs(windowId)).length;
        const badge = await h.sw.evaluate(() => chrome.action.getBadgeText({}));
        return badge === String(count);
    }, { message: 'badge to match tab count' });
});

test('auto-close closes the tab that navigated to a duplicate, even when it is the older tab, and focuses the existing one', async () => {
    await h.setSettings({ autoCloseDuplicates: true });
    const same = h.url('alpha.test', '/same');
    const older = await h.open(h.url('beta.test'));
    await h.open(same);
    const windowId = await h.windowId();
    const before = await h.tabs(windowId);
    const original = before.find(t => t.url === same);
    const navigating = before.find(t => t.url.includes('beta.test'));
    assert.ok(navigating.id < original.id);
    await older.bringToFront();

    await older.goto(same).catch(() => { });

    await waitFor(async () => !(await h.tabs(windowId)).some(t => t.id === navigating.id),
        { message: 'navigating tab closed' });
    const after = await h.tabs(windowId);
    const kept = after.find(t => t.id === original.id);
    assert.ok(kept, 'existing tab kept');
    assert.equal(kept.active, true);
});

test('auto-close does not steal focus for a duplicate opened in the background', async () => {
    await h.setSettings({ autoCloseDuplicates: true });
    await h.open(h.url('alpha.test', '/same'));
    await h.open(h.url('beta.test'));
    const windowId = await h.windowId();
    const activeBefore = (await h.tabs(windowId)).find(t => t.active);

    const bgId = await h.sw.evaluate(async (url) => (await chrome.tabs.create({ url, active: false })).id,
        h.url('alpha.test', '/same'));

    await waitFor(async () => !(await h.tabs(windowId)).some(t => t.id === bgId), { message: 'background duplicate closed' });
    const activeAfter = (await h.tabs(windowId)).find(t => t.active);
    assert.equal(activeAfter.id, activeBefore.id);
});

test('ungroup removes all groups and disables auto-group', async () => {
    await h.setSettings({ autoGroup: true, groupSingleTabs: true });
    await h.open(h.url('alpha.test'));
    await h.open(h.url('beta.test'));
    const windowId = await h.windowId();
    await waitFor(async () => (await h.groupedTitles(windowId)).length === 2, { message: 'groups created' });

    await h.sw.evaluate((w) => ungroupAllTabs(w), windowId);
    await sleep(1000);

    assert.deepEqual(await h.groups(windowId), []);
    assert.equal((await h.getSettings()).autoGroup, false);
});

test('ungroup wins over grouping that was already queued when it ran', async () => {
    await h.setSettings({ autoGroup: true, groupSingleTabs: true });
    await h.open(h.url('alpha.test'));
    await h.open(h.url('beta.test'));
    const windowId = await h.windowId();
    await waitFor(async () => (await h.groupedTitles(windowId)).length === 2, { message: 'groups created' });

    await h.sw.evaluate(async (w) => {
        const created = await chrome.tabs.create({ url: 'http://gamma.test/', active: false });
        const queued = [groupTabsByDomain(w), ensureTabGrouped(created.id)];
        debounceRegroup(w, 0);
        await ungroupAllTabs(w);
        await Promise.all(queued);
    }, windowId);
    await sleep(1500);

    assert.deepEqual(await h.groups(windowId), []);
});

test('welcome page "enable" groups tabs in every window', async () => {
    await h.setSettings({ groupSingleTabs: true });
    await h.open(h.url('alpha.test'));
    await h.sw.evaluate((url) => chrome.windows.create({ url, focused: false }), h.url('beta.test'));
    const welcome = await h.open(h.extUrl('welcome.html'));

    await welcome.click('#enableAutoGroup');

    await waitFor(async () => (await h.groupedTitles()).join() === 'Alpha,Beta', { message: 'groups in both windows' });
    assert.equal((await h.getSettings()).autoGroup, true);
});
