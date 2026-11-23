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
