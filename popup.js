// Tab Manager Pro - Popup Script
// Direct chrome API calls — no background SW round-trips for reads.

// ─── Domain helpers (mirrored from background.js) ────────────────────────────
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const DOMAIN_NAMES = {
  google: 'Google', youtube: 'YouTube', github: 'GitHub', stackoverflow: 'Stack Overflow',
  reddit: 'Reddit', twitter: 'Twitter', facebook: 'Facebook', instagram: 'Instagram',
  linkedin: 'LinkedIn', amazon: 'Amazon', netflix: 'Netflix', spotify: 'Spotify',
  microsoft: 'Microsoft', apple: 'Apple', discord: 'Discord', slack: 'Slack',
  notion: 'Notion', figma: 'Figma', dribbble: 'Dribbble', medium: 'Medium',
  dev: 'DEV', twitch: 'Twitch', pinterest: 'Pinterest', wikipedia: 'Wikipedia', quora: 'Quora'
};

function getDomainName(url) {
  if (!url) return 'Other';
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;
    if (hostname === 'newtab' || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return 'Chrome';
    if (url.startsWith('edge://')) return 'Edge';
    if (url.startsWith('brave://')) return 'Brave';
    if (url.startsWith('about:')) return 'Browser';
    if (url.startsWith('file://')) return 'Local File';
    if (url.startsWith('data:') || url.startsWith('blob:')) return 'Other';
    hostname = hostname.replace(/^www\./, '');
    if (!hostname) return 'Other';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')) return hostname;
    const parts = hostname.split('.');
    let main = '';
    if (parts.length >= 2) {
      const last2 = parts.slice(-2).join('.');
      main = ['co.uk', 'com.au', 'co.in', 'co.jp', 'com.br', 'co.nz'].includes(last2)
        ? (parts.length > 2 ? parts[parts.length - 3] : parts[0])
        : parts[parts.length - 2];
    } else {
      main = parts[0];
    }
    const lower = main.toLowerCase();
    return DOMAIN_NAMES[lower] || (main.charAt(0).toUpperCase() + main.slice(1).toLowerCase());
  } catch { return 'Other'; }
}

function getDomainColor(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    const c = domain.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash = hash & hash;
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

const DUPLICATE_SKIP_PREFIXES = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://'];

function collectDuplicates(tabs) {
  const urlMap = new Map();
  for (const tab of tabs) {
    if (tab.pinned || !tab.url || DUPLICATE_SKIP_PREFIXES.some(p => tab.url.startsWith(p))) continue;
    if (!urlMap.has(tab.url)) urlMap.set(tab.url, { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl, tabIds: [] });
    urlMap.get(tab.url).tabIds.push(tab.id);
  }
  return Array.from(urlMap.values())
    .filter(d => d.tabIds.length > 1)
    .map(d => ({ ...d, count: d.tabIds.length }));
}
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const domainList = document.getElementById('domainList');
  const tabCount = document.getElementById('tabCount');
  const groupAllBtn = document.getElementById('groupAllBtn');
  const ungroupAllBtn = document.getElementById('ungroupAllBtn');
  const autoGroupToggle = document.getElementById('autoGroupToggle');
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  // New elements
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  const findDuplicatesBtn = document.getElementById('findDuplicatesBtn');
  const duplicatesSection = document.getElementById('duplicatesSection');
  const duplicateList = document.getElementById('duplicateList');
  const duplicateCount = document.getElementById('duplicateCount');
  const closeDuplicatesBtn = document.getElementById('closeDuplicatesBtn');
  const recentlyClosedList = document.getElementById('recentlyClosedList');

  // Tab navigation
  const tabNavBtns = document.querySelectorAll('.tab-nav-btn');
  const tabsPanel = document.getElementById('tabsPanel');
  const historyPanel = document.getElementById('historyPanel');

  // Store all tabs data for search filtering
  let allTabsData = null;
  let currentSearchQuery = '';
  let currentSettings = { autoGroup: false, collapseByDefault: false, groupSingleTabs: false, autoCloseDuplicates: false, theme: 'dark' };
  let collapsedDomains = new Set();   // domains the user has explicitly collapsed
  let sortedDomains = new Set();      // domains sorted A-Z by the sort toggle

  // Get the BROWSER window ID — NOT the popup's own window.
  // chrome.windows.getCurrent() from a popup returns the popup window itself
  // (type 'popup'), NOT the browser window with the user's tabs.
  // getLastFocused({windowTypes:['normal']}) explicitly returns the correct window.
  const { id: currentWindowId } = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });

  const SPINNER = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>';

  // Load settings and tabs in PARALLEL — direct API calls, no SW round-trip
  await Promise.all([loadSettings(), loadTabs(), loadShortcuts(), loadPlacement(), loadUpdate()]);

  // Event Listeners
  groupAllBtn.addEventListener('click', handleGroupAll);
  ungroupAllBtn.addEventListener('click', handleUngroupAll);
  autoGroupToggle.addEventListener('change', handleAutoGroupToggle);
  findDuplicatesBtn.addEventListener('click', handleFindDuplicates);
  closeDuplicatesBtn.addEventListener('click', handleCloseAllDuplicates);
  if (themeToggleBtn) themeToggleBtn.addEventListener('click', handleThemeToggle);
  document.getElementById('settingsBtn').addEventListener('click', async () => {
    await chrome.runtime.openOptionsPage();
    window.close();
  });
  document.getElementById('guideBtn').addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    window.close();
  });

  // Search functionality
  searchInput.addEventListener('input', handleSearch);
  searchClear.addEventListener('click', clearSearch);

  // Tab navigation
  tabNavBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /**
   * Switch between Tabs and History panels
   */
  function switchTab(tabName) {
    tabNavBtns.forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-selected', 'true');
    }

    tabsPanel.classList.remove('active');
    historyPanel.classList.remove('active');

    if (tabName === 'tabs') {
      tabsPanel.classList.add('active');
    } else {
      historyPanel.classList.add('active');
      loadRecentlyClosed(); // Load when switching to history
    }
  }

  /**
   * Send message to background script
   */
  async function sendMessage(action, data = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, ...data }, resolve);
    });
  }

  async function loadUpdate() {
    const { pendingUpdate } = await chrome.storage.local.get('pendingUpdate');
    const installed = chrome.runtime.getManifest().version;
    if (!pendingUpdate || compareVersions(pendingUpdate.version, installed) <= 0) return;
    document.getElementById('updateText').textContent = `Version ${pendingUpdate.version} is ready`;
    const button = document.getElementById('updateBtn');
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = 'Updating…';
      sendMessage('applyUpdate');
    });
    document.getElementById('updateSection').hidden = false;
  }

  async function loadPlacement() {
    const section = document.getElementById('placementSection');
    const response = await sendMessage('getPendingPlacement', { windowId: currentWindowId });
    const tab = response && response.pending && response.pending[0];
    if (!tab) {
      section.hidden = true;
      document.body.classList.remove('placing');
      return;
    }

    document.getElementById('placementTab').innerHTML = `
      ${tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://') ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="">` : getFaviconPlaceholder()}
      <span class="tab-title" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title || tab.url)}</span>
    `;
    const groupButtons = response.groups.map(g => `
      <button class="placement-option" data-target="${g.id}">
        <span class="domain-color color-${escapeHtml(g.color)}"></span>${escapeHtml(g.title || 'Unnamed group')}
      </button>
    `).join('');
    document.getElementById('placementOptions').innerHTML = `
      ${groupButtons}
      <button class="placement-option" data-target="site">Group by site (${escapeHtml(tab.domain)})</button>
      <button class="placement-option" data-target="none">Keep ungrouped</button>
    `;
    section.hidden = false;
    document.body.classList.add('placing');

    section.querySelectorAll('.placement-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raw = btn.dataset.target;
        const target = raw === 'site' || raw === 'none' ? raw : Number(raw);
        section.querySelectorAll('.placement-option').forEach(b => { b.disabled = true; });
        await sendMessage('placeTab', { tabId: tab.id, target });
        window.close();
      });
    });
    section.querySelector('.placement-option').focus();
  }

  async function loadShortcuts() {
    const shortcutsEl = document.getElementById('shortcuts');
    const labels = { 'group-all-tabs': 'group', 'ungroup-all-tabs': 'ungroup' };
    const commands = await chrome.commands.getAll();
    const parts = commands
      .filter(c => labels[c.name] && c.shortcut)
      .map(c => `${c.shortcut} ${labels[c.name]}`);
    shortcutsEl.textContent = parts.join(' • ');
    shortcutsEl.hidden = parts.length === 0;
  }

  /**
   * Load user settings — reads chrome.storage.local directly (no SW round-trip)
   */
  async function loadSettings() {
    const [settingsResult, collapsedResult] = await Promise.all([
      chrome.storage.local.get('tabManagerSettings'),
      chrome.storage.local.get('tabManagerCollapsed')
    ]);
    const settings = settingsResult.tabManagerSettings || { autoGroup: false, collapseByDefault: false, groupSingleTabs: false, autoCloseDuplicates: false, theme: 'dark' };
    currentSettings = settings;
    autoGroupToggle.checked = settings.autoGroup || false;
    collapsedDomains = new Set(collapsedResult.tabManagerCollapsed || []);
    applyTheme(settings.theme || 'dark');
  }

  /**
   * Load and display tabs — calls chrome.tabs.query directly (no SW round-trip)
   * Domain organisation runs inline in the popup process.
   */
  async function loadTabs() {
    // Show loading state only initially (first load)
    if (!allTabsData) {
      domainList.innerHTML = `<div class="loading"><div class="spinner"></div>Loading tabs...</div>`;
    }

    try {
      const tabs = await chrome.tabs.query({ windowId: currentWindowId });

      const domainsMap = new Map();

      for (const tab of tabs) {
        // Skip all browser-internal URLs
        if (tab.url && (
          tab.url.startsWith('chrome://') ||
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('chrome-search://') ||
          tab.url.startsWith('about:') ||
          tab.url.startsWith('edge://') ||
          tab.url.startsWith('devtools://') ||
          tab.url.startsWith('brave://')
        )) continue;

        const domain = getDomainName(tab.url);
        if (!domainsMap.has(domain)) {
          domainsMap.set(domain, { name: domain, color: getDomainColor(domain), tabs: [] });
        }
        domainsMap.get(domain).tabs.push({
          id: tab.id,
          title: tab.title || 'New Tab',
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          active: tab.active,
          pinned: tab.pinned,
          groupId: tab.groupId,
          muted: tab.mutedInfo ? tab.mutedInfo.muted : false
        });
      }

      const domains = Array.from(domainsMap.values()).sort((a, b) => b.tabs.length - a.tabs.length);
      const result = { success: true, domains, totalTabs: tabs.length };

      allTabsData = result;
      tabCount.textContent = `${result.totalTabs} tab${result.totalTabs !== 1 ? 's' : ''}`;
      renderDomainGroups(result.domains, currentSearchQuery);
      if (duplicatesSection.style.display !== 'none') renderDuplicates(tabs);

    } catch (error) {
      console.error('Error loading tabs:', error);
      domainList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          <p>Error loading tabs</p>
        </div>
      `;
    }
  }

  /**
   * Handle search input
   */
  function handleSearch(e) {
    currentSearchQuery = e.target.value.trim();
    searchClear.style.display = currentSearchQuery ? 'flex' : 'none';

    if (allTabsData) {
      renderDomainGroups(allTabsData.domains, currentSearchQuery);
    }
  }

  /**
   * Clear search
   */
  function clearSearch() {
    searchInput.value = '';
    currentSearchQuery = '';
    searchClear.style.display = 'none';
    if (allTabsData) {
      renderDomainGroups(allTabsData.domains, '');
    }
    searchInput.focus();
  }

  /**
   * Apply light/dark theme by setting data-theme on <html>
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  /**
   * Handle theme toggle button click
   */
  async function handleThemeToggle() {
    const newTheme = (currentSettings.theme === 'light') ? 'dark' : 'light';
    const { tabManagerSettings = {} } = await chrome.storage.local.get('tabManagerSettings');
    const updated = { ...tabManagerSettings, theme: newTheme };
    await chrome.storage.local.set({ tabManagerSettings: updated });
    currentSettings = { ...currentSettings, theme: newTheme };
    applyTheme(newTheme);
  }

  /**
   * Persist the current collapsed-domains set to storage
   */
  async function saveCollapsedDomains() {
    await chrome.storage.local.set({ tabManagerCollapsed: Array.from(collapsedDomains) });
  }

  // renderSplitViewTabs removed — split view API does not exist

  /**
   * Render domain groups with optional search filter
   */
  function renderDomainGroups(domains, searchQuery = '') {
    if (!domains || domains.length === 0) {
      domainList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
          </svg>
          <p>No tabs found</p>
        </div>
      `;
      return;
    }

    // Filter domains based on search query
    let filteredDomains = domains;
    if (searchQuery) {
      filteredDomains = domains.map(domain => {
        const query = searchQuery.toLowerCase();
        const filteredTabs = domain.tabs.filter(tab =>
          tab.title.toLowerCase().includes(query) ||
          (tab.url || '').toLowerCase().includes(query)
        );
        return filteredTabs.length > 0 ? { ...domain, tabs: filteredTabs } : null;
      }).filter(Boolean);
    }

    if (filteredDomains.length === 0) {
      domainList.innerHTML = `
        <div class="no-results">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <p>No tabs match "${escapeHtml(searchQuery)}"</p>
        </div>
      `;
      return;
    }

    domainList.innerHTML = filteredDomains.map(domain => {
      // Collapse logic: when not searching, honor per-domain memory; fall back to collapseByDefault
      let isCollapsed = false;
      if (!searchQuery) {
        if (collapsedDomains.has(domain.name)) {
          isCollapsed = true;
        } else if (!collapsedDomains.has('__expanded__:' + domain.name)) {
          isCollapsed = currentSettings.collapseByDefault || false;
        }
      }
      // Sort tabs A-Z within this group if toggled
      const isSorted = sortedDomains.has(domain.name);
      const displayTabs = isSorted
        ? [...domain.tabs].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
        : domain.tabs;

      return `
      <div class="domain-group ${isCollapsed ? 'collapsed' : ''}" data-domain="${escapeHtml(domain.name)}">
        <div class="domain-header" tabindex="0" role="button" aria-expanded="${isCollapsed ? 'false' : 'true'}">
          <div class="domain-info">
            <span class="domain-color color-${domain.color}"></span>
            <span class="domain-name">${escapeHtml(domain.name)}</span>
          </div>
          <div class="domain-meta">
            <span class="domain-count">${domain.tabs.length}</span>
            <button class="sort-btn${isSorted ? ' active' : ''}" data-domain="${escapeHtml(domain.name)}" title="${isSorted ? 'Unsort' : 'Sort A-Z'}" aria-label="${isSorted ? 'Unsort tabs' : 'Sort tabs A to Z'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M7 12h10M11 18h2"/>
              </svg>
            </button>
            <svg class="collapse-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        </div>
        <div class="domain-tabs">
          ${displayTabs.map(tab => createTabItem(tab, false, searchQuery)).join('')}
        </div>
      </div>
    `}).join('');

    // Attach click listeners
    attachTabClickListeners(domainList);
    attachDomainHeaderListeners();
    attachSortBtnListeners();
  }

  /**
   * Create HTML for a single tab item with optional search highlighting
   */
  function createTabItem(tab, _unused = false, searchQuery = '') {
    // Filter out chrome:// URLs for favicons (can't load internal resources)
    const validFavicon = tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://');
    const favicon = validFavicon
      ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="">`
      : getFaviconPlaceholder();

    const activeClass = tab.active ? 'active' : '';
    const mutedClass = tab.muted ? 'muted' : '';
    const pinnedIcon = tab.pinned ? `
      <span class="tab-pinned" title="Pinned">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
        </svg>
      </span>
    ` : '';

    const muteTitle = tab.muted ? 'Unmute tab' : 'Mute tab';
    const muteBtn = `
      <button class="tab-action-btn mute-tab${tab.muted ? ' active' : ''}" data-tab-id="${tab.id}" data-muted="${tab.muted ? 'true' : 'false'}" title="${muteTitle}" aria-label="${muteTitle}">
        ${tab.muted
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`
        }
      </button>
    `;

    // Highlight search matches in title
    const rawTitle = tab.title || 'New Tab';
    const displayTitle = searchQuery
      ? rawTitle.split(new RegExp(`(${escapeRegex(searchQuery)})`, 'gi'))
        .map((part, i) => i % 2 ? `<span class="search-highlight">${escapeHtml(part)}</span>` : escapeHtml(part))
        .join('')
      : escapeHtml(rawTitle);

    return `
      <div class="tab-item ${activeClass} ${mutedClass}" data-tab-id="${tab.id}" title="${escapeHtml(tab.title)}" tabindex="0" role="button">
        ${favicon}
        <span class="tab-title">${displayTitle}</span>
        ${pinnedIcon}
        <div class="tab-actions">
          ${muteBtn}
          <button class="tab-action-btn close-tab" data-tab-id="${tab.id}" title="Close tab" aria-label="Close tab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Escape regex special characters
   */
  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get favicon placeholder HTML
   */
  function getFaviconPlaceholder() {
    return `
      <span class="tab-favicon-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
        </svg>
      </span>
    `;
  }

  function onActivateKey(el) {
    el.addEventListener('keydown', (e) => {
      if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      el.click();
    });
  }

  /**
   * Attach click listeners to tab items
   */
  function attachTabClickListeners(container) {
    container.querySelectorAll('.tab-item').forEach(item => {
      onActivateKey(item);
      item.addEventListener('click', async (e) => {
        // Check if mute button was clicked
        if (e.target.closest('.mute-tab')) {
          e.stopPropagation();
          const btn = e.target.closest('.mute-tab');
          const tabId = parseInt(btn.dataset.tabId);
          const isMuted = btn.dataset.muted === 'true';
          try {
            await chrome.tabs.update(tabId, { muted: !isMuted });
            await loadTabs();
          } catch (err) {
            console.error('Error toggling mute:', err);
          }
          return;
        }

        // Check if close button was clicked
        if (e.target.closest('.close-tab')) {
          e.stopPropagation();
          const tabId = parseInt(e.target.closest('.close-tab').dataset.tabId);
          try {
            await chrome.tabs.remove(tabId);
            await loadTabs();
          } catch (err) {
            console.error('Error closing tab:', err);
            await loadTabs(); // reload anyway to sync state
          }
          return;
        }

        // Switch to clicked tab
        const tabId = parseInt(item.dataset.tabId);
        try {
          await chrome.tabs.update(tabId, { active: true });
          window.close();
        } catch (err) {
          console.error('Error switching to tab:', err);
          await loadTabs(); // tab may no longer exist — refresh
        }
      });
    });

    // Handle favicon load errors
    container.querySelectorAll('.tab-favicon').forEach(img => {
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
    });
  }

  /**
   * Attach click listeners to domain headers for collapse/expand
   */
  function attachDomainHeaderListeners() {
    document.querySelectorAll('.domain-header').forEach(header => {
      onActivateKey(header);
      header.addEventListener('click', (e) => {
        // Don't collapse if sort button was clicked
        if (e.target.closest('.sort-btn')) return;
        const group = header.parentElement;
        const domain = group.dataset.domain;
        const nowCollapsed = !group.classList.contains('collapsed');
        group.classList.toggle('collapsed', nowCollapsed);
        header.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
        // Persist: track collapsed domains
        if (nowCollapsed) {
          collapsedDomains.add(domain);
          collapsedDomains.delete('__expanded__:' + domain);
        } else {
          collapsedDomains.delete(domain);
          collapsedDomains.add('__expanded__:' + domain);
        }
        saveCollapsedDomains();
      });
    });
  }

  /**
   * Attach click listeners to sort buttons in domain headers
   */
  function attachSortBtnListeners() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const domain = btn.dataset.domain;
        if (sortedDomains.has(domain)) {
          sortedDomains.delete(domain);
        } else {
          sortedDomains.add(domain);
        }
        if (allTabsData) {
          renderDomainGroups(allTabsData.domains, currentSearchQuery);
        }
      });
    });
  }

  /**
   * Handle group all tabs button click
   */
  async function handleGroupAll() {
    groupAllBtn.disabled = true;
    groupAllBtn.innerHTML = SPINNER;

    // Enable auto-group — write directly to storage
    const { tabManagerSettings = {} } = await chrome.storage.local.get('tabManagerSettings');
    await chrome.storage.local.set({ tabManagerSettings: { ...tabManagerSettings, autoGroup: true } });
    autoGroupToggle.checked = true;

    // Pass real windowId — background SW cannot resolve WINDOW_ID_CURRENT (-2)
    const response = await sendMessage('groupTabs', { windowId: currentWindowId });
    const success = response && response.success;

    await loadTabs();

    groupAllBtn.disabled = false;
    if (success) {
      groupAllBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
      setTimeout(() => {
        groupAllBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        `;
      }, 2000);
    } else {
      groupAllBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      `;
      groupAllBtn.title = 'Grouping failed — try again';
      setTimeout(() => {
        groupAllBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        `;
        groupAllBtn.title = 'Group all tabs';
      }, 2000);
    }
  }

  /**
   * Handle ungroup all tabs button click
   */
  async function handleUngroupAll() {
    ungroupAllBtn.disabled = true;
    ungroupAllBtn.innerHTML = SPINNER;

    // Pass real windowId — background SW cannot resolve WINDOW_ID_CURRENT (-2)
    await sendMessage('ungroupTabs', { windowId: currentWindowId });

    // Reload toggle state — background sets autoGroup=false during ungroup
    const { tabManagerSettings = {} } = await chrome.storage.local.get('tabManagerSettings');
    autoGroupToggle.checked = tabManagerSettings.autoGroup || false;
    await loadTabs();

    ungroupAllBtn.disabled = false;
    ungroupAllBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    setTimeout(() => {
      ungroupAllBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14"/>
        </svg>
      `;
    }, 2000);
  }

  /**
   * Handle auto-group toggle — write directly to storage (no SW round-trip)
   */
  async function handleAutoGroupToggle() {
    const { tabManagerSettings = {} } = await chrome.storage.local.get('tabManagerSettings');
    const updated = { ...tabManagerSettings, autoGroup: autoGroupToggle.checked };
    await chrome.storage.local.set({ tabManagerSettings: updated });
    // Background SW listens on storage.onChanged and will start/stop the alarm automatically
  }

  /**
   * Find duplicate tabs
   */
  async function handleFindDuplicates() {
    const tabs = await chrome.tabs.query({ windowId: currentWindowId });
    if (renderDuplicates(tabs)) return;

    findDuplicatesBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    `;
    findDuplicatesBtn.title = 'No duplicates found!';
    setTimeout(() => {
      findDuplicatesBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="8" y="8" width="12" height="12" rx="2"/>
          <path d="M4 16V4h12"/>
        </svg>
      `;
      findDuplicatesBtn.title = 'Find duplicate tabs';
    }, 2000);
  }

  /**
   * Show the duplicates section for the given tabs, or hide it if there are none.
   * @returns {boolean} true if duplicates were found
   */
  function renderDuplicates(tabs) {
    const duplicates = collectDuplicates(tabs);
    if (duplicates.length === 0) {
      duplicatesSection.style.display = 'none';
      return false;
    }

    duplicatesSection.style.display = 'block';
    duplicateCount.textContent = duplicates.length;

    duplicateList.innerHTML = duplicates.map(dup => `
      <div class="duplicate-item" data-url="${escapeHtml(dup.url)}">
        <div class="duplicate-info">
          ${dup.favIconUrl ? `<img class="tab-favicon" src="${escapeHtml(dup.favIconUrl)}" alt="">` : getFaviconPlaceholder()}
          <span class="tab-title">${escapeHtml(dup.title)}</span>
        </div>
        <span class="duplicate-badge">${dup.count}×</span>
      </div>
    `).join('');
    return true;
  }

  /**
   * Close all duplicate tabs
   */
  async function handleCloseAllDuplicates() {
    closeDuplicatesBtn.disabled = true;
    closeDuplicatesBtn.textContent = 'Closing...';

    const tabs = await chrome.tabs.query({ windowId: currentWindowId });
    const toClose = collectDuplicates(tabs).flatMap(d => d.tabIds.slice(1));
    if (toClose.length > 0) await chrome.tabs.remove(toClose).catch(err => console.error('Error closing duplicates:', err));

    duplicatesSection.style.display = 'none';
    await loadTabs();
    closeDuplicatesBtn.disabled = false;
    closeDuplicatesBtn.textContent = 'Close All';
  }

  /**
   * Load recently closed tabs
   */
  async function loadRecentlyClosed() {
    try {
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 15 }); // Increased limit to account for window tabs
      let closedItems = [];

      for (const session of sessions) {
        if (session.tab) {
          closedItems.push({
            ...session.tab,
            sessionId: session.tab.sessionId,
            type: 'tab'
          });
        } else if (session.window && session.window.tabs) {
          // Add all tabs from the closed window
          session.window.tabs.forEach(tab => {
            closedItems.push({
              ...tab,
              sessionId: session.window.sessionId, // Use window session ID for restoration
              type: 'window',
              windowId: session.window.id
            });
          });
        }
      }

      // Limit display to 15 items
      closedItems = closedItems.slice(0, 15);

      if (closedItems.length === 0) {
        recentlyClosedList.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
            <p>No recently closed tabs</p>
          </div>
        `;
        return;
      }

      recentlyClosedList.innerHTML = closedItems.map(item => {
        const validFavicon = item.favIconUrl && !item.favIconUrl.startsWith('chrome://');
        const isWindow = item.type === 'window';

        return `
          <div class="tab-item" data-session-id="${escapeHtml(item.sessionId)}" title="${escapeHtml(item.title)}">
            ${validFavicon ? `<img class="tab-favicon" src="${escapeHtml(item.favIconUrl)}" alt="">` : getFaviconPlaceholder()}
            <div class="tab-info" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;">
              <span class="tab-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.title || 'Untitled')}</span>
              ${isWindow ? `<span class="window-badge">Window</span>` : ''}
            </div>
            <button class="restore-btn" data-session-id="${escapeHtml(item.sessionId)}" title="${isWindow ? 'Restore entire window' : 'Restore tab'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
                <path d="M9 12a9 9 0 0 1 5.99-8.49" style="opacity: 0;"></path>
              </svg>
            </button>
          </div>
        `;
      }).join('');

      // Attach restore listeners
      recentlyClosedList.querySelectorAll('.restore-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const sessionId = btn.dataset.sessionId;
          try {
            await chrome.sessions.restore(sessionId);
            await loadRecentlyClosed();
            await loadTabs();
          } catch (err) {
            console.error('Error restoring session:', err);
            const item = btn.closest('.tab-item');
            if (item) {
              const oldText = btn.innerHTML;
              const oldTitle = btn.title;
              btn.textContent = '!';
              btn.title = 'Restore failed';
              setTimeout(() => { btn.innerHTML = oldText; btn.title = oldTitle; }, 2000);
            }
          }
        });
      });

      // Handle favicon load errors
      recentlyClosedList.querySelectorAll('.tab-favicon').forEach(img => {
        img.addEventListener('error', () => {
          img.style.display = 'none';
        });
      });
    } catch (error) {
      console.error('Error loading recently closed tabs:', error);
      recentlyClosedList.innerHTML = `
        <div class="empty-state">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
           </svg>
          <p>Unable to load history</p>
        </div>
      `;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
});
