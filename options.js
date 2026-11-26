// Tab Manager Pro — Options page script
const DEFAULTS = {
  autoGroup: false,
  collapseByDefault: false,
  groupSingleTabs: false,
  autoCloseDuplicates: false,
  askForAddressBarTabs: false,
  theme: 'dark'
};

let currentSettings = { ...DEFAULTS };

const TOGGLE_IDS = ['autoGroup', 'groupSingleTabs', 'collapseByDefault', 'askForAddressBarTabs', 'autoCloseDuplicates'];

async function loadSettings() {
  const result = await chrome.storage.local.get('tabManagerSettings');
  currentSettings = { ...DEFAULTS, ...(result.tabManagerSettings || {}) };

  for (const id of TOGGLE_IDS) {
    const el = document.getElementById(id);
    if (el) el.checked = !!currentSettings[id];
  }

  applyTheme(currentSettings.theme || 'dark');
}

async function saveSetting(key, value) {
  const result = await chrome.storage.local.get('tabManagerSettings');
  currentSettings = { ...DEFAULTS, ...(result.tabManagerSettings || {}), [key]: value };
  await chrome.storage.local.set({ tabManagerSettings: currentSettings });
  showToast();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeDark').classList.toggle('active', theme === 'dark');
  document.getElementById('themeLight').classList.toggle('active', theme === 'light');
}

function showToast() {
  const toast = document.getElementById('saveToast');
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.tabManagerSettings) loadSettings();
  });

  // Wire up toggle checkboxes
  for (const id of TOGGLE_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('change', () => saveSetting(id, el.checked));
  }

  // Wire up theme buttons
  document.getElementById('themeDark').addEventListener('click', () => {
    applyTheme('dark');
    saveSetting('theme', 'dark');
  });
  document.getElementById('themeLight').addEventListener('click', () => {
    applyTheme('light');
    saveSetting('theme', 'light');
  });
});

const UPDATE_CHECK_SUPPORTED = typeof chrome.runtime.requestUpdateCheck === 'function';
const AUTO_UPDATE_TEXT = 'Your browser updates this extension automatically.';

const UPDATE_MESSAGES = {
  update_available: (r) => `Version ${r.version} found. It's downloading — "Update now" will appear when it's ready.`,
  no_update: () => "You're on the latest version.",
  throttled: () => 'Checked very recently. Try again in a little while.',
  unsupported: () => AUTO_UPDATE_TEXT
};

async function showUpdateState() {
  const installed = chrome.runtime.getManifest().version;
  document.getElementById('installedVersion').textContent = installed;
  const { pendingUpdate } = await chrome.storage.local.get('pendingUpdate');
  const ready = pendingUpdate && pendingUpdate.version.localeCompare(installed, undefined, { numeric: true }) > 0;
  document.getElementById('applyUpdateBtn').hidden = !ready;
  document.getElementById('checkUpdatesBtn').hidden = !!ready || !UPDATE_CHECK_SUPPORTED;
  if (ready) document.getElementById('updateStatus').textContent = `Version ${pendingUpdate.version} is ready to install.`;
  else if (!UPDATE_CHECK_SUPPORTED) document.getElementById('updateStatus').textContent = AUTO_UPDATE_TEXT;
}

document.addEventListener('DOMContentLoaded', async () => {
  await showUpdateState();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pendingUpdate) showUpdateState();
  });

  const status = document.getElementById('updateStatus');
  const checkBtn = document.getElementById('checkUpdatesBtn');
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    status.textContent = 'Checking…';
    const result = await chrome.runtime.sendMessage({ action: 'checkForUpdate' });
    const message = UPDATE_MESSAGES[result?.status];
    status.textContent = message ? message(result) : `Couldn't check for updates${result?.message ? `: ${result.message}` : '.'}`;
    checkBtn.disabled = false;
  });
  document.getElementById('applyUpdateBtn').addEventListener('click', () => {
    status.textContent = 'Updating…';
    chrome.runtime.sendMessage({ action: 'applyUpdate' });
  });
});
