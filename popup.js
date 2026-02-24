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
    hostname = hostname.replace(/^www\./, '');
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
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const domainList = document.getElementById('domainList');
  const tabCount = document.getElementById('tabCount');
  const groupAllBtn = document.getElementById('groupAllBtn');
  const ungroupAllBtn = document.getElementById('ungroupAllBtn');
  const autoGroupToggle = document.getElementById('autoGroupToggle');
  // Split view removed — chrome.tabs.splitViewId API does not exist in Chrome/Brave

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

  // Capture real window ID at startup — service worker cannot use WINDOW_ID_CURRENT (-2)
  // Without this, chrome.tabs.query & chrome.tabGroups.query in the SW return empty.
  const { id: currentWindowId } = await chrome.windows.getCurrent();

  // Load settings and tabs in PARALLEL — direct API calls, no SW round-trip
  await Promise.all([loadSettings(), loadTabs()]);

  // Event Listeners
  groupAllBtn.addEventListener('click', handleGroupAll);
  ungroupAllBtn.addEventListener('click', handleUngroupAll);
  autoGroupToggle.addEventListener('change', handleAutoGroupToggle);
  findDuplicatesBtn.addEventListener('click', handleFindDuplicates);
  closeDuplicatesBtn.addEventListener('click', handleCloseAllDuplicates);

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
    tabNavBtns.forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

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

  /**
   * Load user settings — reads chrome.storage.local directly (no SW round-trip)
   */
  async function loadSettings() {
    const result = await chrome.storage.local.get('tabManagerSettings');
    const settings = result.tabManagerSettings || { autoGroup: false };
    autoGroupToggle.checked = settings.autoGroup || false;
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
      const tabs = await chrome.tabs.query({ currentWindow: true });

      const domainsMap = new Map();

      for (const tab of tabs) {
        // Skip all browser-internal URLs
        if (tab.url && (
          tab.url.startsWith('chrome://') ||
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('about:') ||
          tab.url.startsWith('edge://') ||
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
          groupId: tab.groupId
        });
      }

      const domains = Array.from(domainsMap.values()).sort((a, b) => b.tabs.length - a.tabs.length);
      const result = { success: true, domains, totalTabs: tabs.length };

      allTabsData = result;
      tabCount.textContent = `${result.totalTabs} tab${result.totalTabs !== 1 ? 's' : ''}`;
      renderDomainGroups(result.domains, currentSearchQuery);

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
    currentSearchQuery = e.target.value.toLowerCase().trim();
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
        const filteredTabs = domain.tabs.filter(tab =>
          tab.title.toLowerCase().includes(searchQuery) ||
          tab.url.toLowerCase().includes(searchQuery)
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

    // Determine if groups should be collapsed (only when not searching)
    const collapsedClass = searchQuery ? '' : 'collapsed';

    domainList.innerHTML = filteredDomains.map(domain => `
      <div class="domain-group ${collapsedClass}" data-domain="${escapeHtml(domain.name)}">
        <div class="domain-header">
          <div class="domain-info">
            <span class="domain-color color-${domain.color}"></span>
            <span class="domain-name">${escapeHtml(domain.name)}</span>
          </div>
          <div class="domain-meta">
            <span class="domain-count">${domain.tabs.length}</span>
            <svg class="collapse-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        </div>
        <div class="domain-tabs">
          ${domain.tabs.map(tab => createTabItem(tab, false, searchQuery)).join('')}
        </div>
      </div>
    `).join('');

    // Attach click listeners
    attachTabClickListeners(domainList);
    attachDomainHeaderListeners();
  }

  /**
   * Create HTML for a single tab item with optional search highlighting
   */
  function createTabItem(tab, showSplitBadge = false, searchQuery = '') {
    // Filter out chrome:// URLs for favicons (can't load internal resources)
    const validFavicon = tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://');
    const favicon = validFavicon
      ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="">`
      : getFaviconPlaceholder();

    const activeClass = tab.active ? 'active' : '';
    const pinnedIcon = tab.pinned ? `
      <span class="tab-pinned" title="Pinned">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
        </svg>
      </span>
    ` : '';

    const splitBadge = showSplitBadge ? `
      <span class="split-view-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="18" rx="2"/>
          <path d="M12 3v18"/>
        </svg>
        Split
      </span>
    ` : '';

    // Highlight search matches in title
    let displayTitle = escapeHtml(tab.title || 'New Tab');
    if (searchQuery) {
      const regex = new RegExp(`(${escapeRegex(searchQuery)})`, 'gi');
      displayTitle = displayTitle.replace(regex, '<span class="search-highlight">$1</span>');
    }

    return `
      <div class="tab-item ${activeClass}" data-tab-id="${tab.id}" title="${escapeHtml(tab.title)}">
        ${favicon}
        <span class="tab-title">${displayTitle}</span>
        ${pinnedIcon}
        ${splitBadge}
        <div class="tab-actions">
          <button class="tab-action-btn close-tab" data-tab-id="${tab.id}" title="Close tab">
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

  /**
   * Attach click listeners to tab items
   */
  function attachTabClickListeners(container) {
    container.querySelectorAll('.tab-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        // Check if close button was clicked
        if (e.target.closest('.close-tab')) {
          e.stopPropagation();
          const tabId = parseInt(e.target.closest('.close-tab').dataset.tabId);
          await chrome.tabs.remove(tabId);
          await loadTabs();
          return;
        }

        // Switch to clicked tab
        const tabId = parseInt(item.dataset.tabId);
        await chrome.tabs.update(tabId, { active: true });
        window.close();
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
   * Attach click listeners to domain headers for collapse
   */
  function attachDomainHeaderListeners() {
    document.querySelectorAll('.domain-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.parentElement;
        group.classList.toggle('collapsed');
      });
    });
  }

  /**
   * Handle group all tabs button click
   */
  async function handleGroupAll() {
    groupAllBtn.disabled = true;
    groupAllBtn.innerHTML = `
      <div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
      Grouping...
    `;

    // Enable auto-group — write directly to storage
    const { tabManagerSettings = {} } = await chrome.storage.local.get('tabManagerSettings');
    await chrome.storage.local.set({ tabManagerSettings: { ...tabManagerSettings, autoGroup: true } });
    autoGroupToggle.checked = true;

    // Pass real windowId — background SW cannot resolve WINDOW_ID_CURRENT (-2)
    await sendMessage('groupTabs', { windowId: currentWindowId });

    // DEBUG: verify what Brave actually stored for group titles
    const groups = await chrome.tabGroups.query({ windowId: currentWindowId });
    console.log('[TabManager popup] Groups after grouping:',
      groups.map(g => `id=${g.id} title="${g.title}" color=${g.color} collapsed=${g.collapsed}`).join(' | ')
    );

    await loadTabs();

    groupAllBtn.disabled = false;
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
  }

  /**
   * Handle ungroup all tabs button click
   */
  async function handleUngroupAll() {
    ungroupAllBtn.disabled = true;
    ungroupAllBtn.innerHTML = `
      <div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
      Ungrouping...
    `;

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
    // Run duplicate detection directly in popup — no SW needed
    const tabs = await chrome.tabs.query({ windowId: currentWindowId });
    const urlMap = new Map();
    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:') || tab.url.startsWith('edge://') || tab.url.startsWith('brave://')) continue;
      if (!urlMap.has(tab.url)) urlMap.set(tab.url, { tabs: [], title: tab.title, favIconUrl: tab.favIconUrl });
      urlMap.get(tab.url).tabs.push(tab.id);
    }
    const duplicates = [];
    for (const [url, data] of urlMap.entries()) {
      if (data.tabs.length > 1) duplicates.push({ url, title: data.title, favIconUrl: data.favIconUrl, count: data.tabs.length, tabIds: data.tabs });
    }
    const result = { success: true, duplicates };

    if (!result.success || result.duplicates.length === 0) {
      duplicatesSection.style.display = 'none';
      // Show a brief message
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
        findDuplicatesBtn.title = 'Find Duplicates';
      }, 2000);
      return;
    }

    // Show duplicates section
    duplicatesSection.style.display = 'block';
    duplicateCount.textContent = result.duplicates.length;

    duplicateList.innerHTML = result.duplicates.map(dup => `
      <div class="duplicate-item" data-url="${escapeHtml(dup.url)}">
        <div class="duplicate-info">
          ${dup.favIconUrl ? `<img class="tab-favicon" src="${escapeHtml(dup.favIconUrl)}" alt="">` : getFaviconPlaceholder()}
          <span class="tab-title">${escapeHtml(dup.title)}</span>
        </div>
        <span class="duplicate-badge">${dup.count}×</span>
      </div>
    `).join('');
  }

  /**
   * Close all duplicate tabs
   */
  async function handleCloseAllDuplicates() {
    closeDuplicatesBtn.disabled = true;
    closeDuplicatesBtn.textContent = 'Closing...';

    // Close duplicates directly — no SW needed
    const tabs = await chrome.tabs.query({ windowId: currentWindowId });
    const urlMap = new Map();
    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:') || tab.url.startsWith('edge://') || tab.url.startsWith('brave://')) continue;
      if (!urlMap.has(tab.url)) urlMap.set(tab.url, []);
      urlMap.get(tab.url).push(tab.id);
    }
    const toClose = [];
    for (const ids of urlMap.values()) { if (ids.length > 1) toClose.push(...ids.slice(1)); }
    if (toClose.length > 0) await chrome.tabs.remove(toClose);

    duplicatesSection.style.display = 'none';
    await loadTabs();
    closeDuplicatesBtn.disabled = false;
    closeDuplicatesBtn.textContent = 'Close All Duplicates';
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
          <div class="tab-item" data-session-id="${item.sessionId}" title="${escapeHtml(item.title)}">
            ${validFavicon ? `<img class="tab-favicon" src="${escapeHtml(item.favIconUrl)}" alt="">` : getFaviconPlaceholder()}
            <div class="tab-info" style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;">
              <span class="tab-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.title || 'Untitled')}</span>
              ${isWindow ? `<span class="window-badge">Window</span>` : ''}
            </div>
            <button class="restore-btn" data-session-id="${item.sessionId}" title="${isWindow ? 'Restore entire window' : 'Restore tab'}">
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
          await chrome.sessions.restore(sessionId);
          await loadRecentlyClosed();
          await loadTabs();
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
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
