// Tab Manager Pro — Getting-started guide
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
const COMMAND_LABELS = { 'group-all-tabs': 'Group all tabs by site', 'ungroup-all-tabs': 'Ungroup all tabs' };

async function readSettings() {
  const { tabManagerSettings = {} } = await chrome.storage.local.get('tabManagerSettings');
  return tabManagerSettings;
}

async function updateSettings(changes) {
  const current = await readSettings();
  await chrome.storage.local.set({ tabManagerSettings: { ...current, ...changes } });
}

async function watchPinned() {
  const status = document.getElementById('pinStatus');
  if (!chrome.action.getUserSettings) return;
  const check = async () => {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    if (!isOnToolbar) return false;
    status.className = 'status ok';
    status.innerHTML = `${CHECK_ICON}<span>Pinned — Tab Manager Pro is on your toolbar.</span>`;
    return true;
  };
  if (await check()) return;
  const timer = setInterval(async () => { if (await check()) clearInterval(timer); }, 1500);
}

async function showShortcuts() {
  const list = document.getElementById('shortcutList');
  const commands = (await chrome.commands.getAll()).filter(c => COMMAND_LABELS[c.name]);
  list.innerHTML = '';
  for (const command of commands) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = COMMAND_LABELS[command.name];
    const keys = document.createElement(command.shortcut ? 'kbd' : 'span');
    keys.textContent = command.shortcut || 'Not set';
    if (!command.shortcut) keys.className = 'not-set';
    item.append(label, keys);
    list.append(item);
  }
}

async function initGrouping() {
  const settings = await readSettings();
  const result = document.getElementById('choiceResult');
  const enable = document.getElementById('enableAutoGroup');
  const skip = document.getElementById('skipAutoGroup');

  const showAutoGroupOn = () => {
    enable.disabled = true;
    enable.textContent = 'Auto-grouping is on';
    result.textContent = 'Done — your open tabs are being grouped by site.';
  };
  if (settings.autoGroup) showAutoGroupOn();

  enable.addEventListener('click', async () => {
    await updateSettings({ autoGroup: true });
    chrome.runtime.sendMessage({ action: 'groupAllWindows' }).catch(() => { });
    showAutoGroupOn();
  });
  skip.addEventListener('click', async () => {
    await updateSettings({ autoGroup: false });
    enable.disabled = false;
    enable.textContent = 'Turn on auto-grouping';
    result.textContent = 'Got it — use the + button in the popup or the shortcut whenever you want to group.';
  });

  for (const id of ['groupSingleTabs', 'askForAddressBarTabs']) {
    const toggle = document.getElementById(id);
    toggle.checked = !!settings[id];
    toggle.addEventListener('change', () => updateSettings({ [id]: toggle.checked }));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await readSettings();
  document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');

  document.getElementById('changeShortcuts').addEventListener('click', () =>
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  document.getElementById('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('finish').addEventListener('click', () => window.close());

  await Promise.all([watchPinned(), showShortcuts(), initGrouping()]);
});
