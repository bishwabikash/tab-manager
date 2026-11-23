const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor } = require('./helpers');

let h;
beforeEach(async () => { h = await launch(); });
afterEach(async () => { await h.close(); });

const waitForPage = (fragment) => waitFor(() => h.context.pages().find(p => p.url().includes(fragment)), { message: fragment });

test('guide toggles save settings and the shortcut list matches the browser', async () => {
    await h.setSettings({ groupSingleTabs: false, askForAddressBarTabs: false });
    const guide = await h.open(h.extUrl('welcome.html'));
    await guide.waitForSelector('#shortcutList li');

    await guide.locator('#askForAddressBarTabs').focus();
    await guide.keyboard.press(' ');
    await guide.click('label:has(#groupSingleTabs)');
    await waitFor(async () => {
        const s = await h.getSettings();
        return s.askForAddressBarTabs === true && s.groupSingleTabs === true;
    }, { message: 'toggles saved' });

    const commands = await guide.evaluate(() => chrome.commands.getAll());
    const shown = await guide.$$eval('#shortcutList li', els => els.map(e => e.lastElementChild.textContent));
    const expected = commands.filter(c => ['group-all-tabs', 'ungroup-all-tabs'].includes(c.name)).map(c => c.shortcut || 'Not set');
    assert.deepEqual(shown, expected);
    assert.ok((await guide.textContent('#pinStatus')).length > 10, 'pin status explains what to do');
});

test('guide "Turn on auto-grouping" stays open and reflects the choice', async () => {
    await h.setSettings({ autoGroup: false });
    const guide = await h.open(h.extUrl('welcome.html'));
    await guide.click('#enableAutoGroup');
    await waitFor(async () => (await h.getSettings()).autoGroup === true, { message: 'auto-group on' });
    assert.equal(await guide.isDisabled('#enableAutoGroup'), true);
    assert.match(await guide.textContent('#choiceResult'), /grouped by site/);
    assert.ok(!guide.isClosed(), 'guide does not close itself');

    await guide.click('#skipAutoGroup');
    await waitFor(async () => (await h.getSettings()).autoGroup === false, { message: 'auto-group off' });
    assert.equal(await guide.isDisabled('#enableAutoGroup'), false);
});

test('guide buttons open settings and close the guide', async () => {
    const guide = await h.open(h.extUrl('welcome.html'));
    await guide.click('#openSettings');
    await waitForPage('options.html');
    const closed = guide.waitForEvent('close');
    await guide.click('#finish');
    await closed;
});

test('popup has visible settings and guide buttons', async () => {
    const popup = await h.open(h.extUrl('popup.html'));
    assert.equal(await popup.isVisible('#settingsBtn'), true);
    const closed = popup.waitForEvent('close');
    await popup.click('#settingsBtn').catch(() => { });
    await closed;
    await waitForPage('options.html');

    const again = await h.open(h.extUrl('popup.html'));
    const closedAgain = again.waitForEvent('close');
    await again.click('#guideBtn').catch(() => { });
    await closedAgain;
    await waitForPage('welcome.html');
});

test('popup shows "Update now" only for a newer downloaded version, and it reloads the extension', async () => {
    const installed = await h.sw.evaluate(() => chrome.runtime.getManifest().version);
    await h.sw.evaluate(v => chrome.storage.local.set({ pendingUpdate: { version: v } }), installed);
    let popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('.domain-list');
    assert.equal(await popup.isHidden('#updateSection'), true, 'same version is not an update');
    await popup.close();

    await h.sw.evaluate(() => chrome.storage.local.set({ pendingUpdate: { version: '99.0.0' } }));
    popup = await h.open(h.extUrl('popup.html'));
    await popup.waitForSelector('#updateSection:not([hidden])');
    assert.equal(await popup.textContent('#updateText'), 'Version 99.0.0 is ready');

    const workerStopped = new Promise(resolve => h.sw.once('close', resolve));
    const popupClosed = popup.waitForEvent('close');
    await popup.click('#updateBtn').catch(() => { });
    await Promise.all([workerStopped, popupClosed]);
});

test('settings page shows the version, checks for updates and offers a ready update', async () => {
    const installed = await h.sw.evaluate(() => chrome.runtime.getManifest().version);
    const options = await h.open(h.extUrl('options.html'));
    assert.equal(await options.textContent('#installedVersion'), installed);
    assert.equal(await options.isHidden('#applyUpdateBtn'), true);

    await options.click('#checkUpdatesBtn');
    await waitFor(async () => !/Checking/.test(await options.textContent('#updateStatus')), { message: 'check finished' });
    assert.match(await options.textContent('#updateStatus'), /latest version|Checked very recently|Couldn't check/);

    await h.sw.evaluate(() => chrome.storage.local.set({ pendingUpdate: { version: '99.0.0' } }));
    await options.waitForSelector('#applyUpdateBtn:not([hidden])');
    assert.equal(await options.isHidden('#checkUpdatesBtn'), true);
    assert.match(await options.textContent('#updateStatus'), /99\.0\.0 is ready/);
});

test('the update check is scheduled every 6 hours without being reset on each wake', async () => {
    const first = await h.sw.evaluate(() => chrome.alarms.get('update-check'));
    assert.equal(first.periodInMinutes, 360);
    await h.sw.evaluate(() => scheduleUpdateCheck());
    const second = await h.sw.evaluate(() => chrome.alarms.get('update-check'));
    assert.equal(second.scheduledTime, first.scheduledTime);
});
