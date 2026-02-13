// Tab Manager Pro - Popup Script
// Handles UI interactions and communication with background service worker

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const domainList = document.getElementById('domainList');
  const tabCount = document.getElementById('tabCount');
  const groupAllBtn = document.getElementById('groupAllBtn');
  const ungroupAllBtn = document.getElementById('ungroupAllBtn');
  const autoGroupToggle = document.getElementById('autoGroupToggle');
  const splitViewSection = document.getElementById('splitViewSection');
  const splitViewTabs = document.getElementById('splitViewTabs');

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

  // Load settings and tabs on popup open
  await loadSettings();
  await loadTabs();

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
   * Load user settings
   */
  async function loadSettings() {
    const settings = await sendMessage('loadSettings');
    if (settings) {
      autoGroupToggle.checked = settings.autoGroup || false;
    }
  }

  /**
   * Load and display tabs organized by domain
   */
  async function loadTabs() {
    domainList.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        Loading tabs...
      </div>
    `;

    const result = await sendMessage('getOrganizedTabs');

    if (!result.success) {
      domainList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          <p>Error loading tabs</p>
        </div>
      `;
      return;
    }

    // Store tabs data for search
    allTabsData = result;

    // Update tab count
    tabCount.textContent = `${result.totalTabs} tab${result.totalTabs !== 1 ? 's' : ''}`;

    // Handle split view tabs
    if (result.splitViewTabs && result.splitViewTabs.length > 0) {
      splitViewSection.style.display = 'block';
      renderSplitViewTabs(result.splitViewTabs);
    } else {
      splitViewSection.style.display = 'none';
    }

    // Render domain groups (with search filter if active)
    renderDomainGroups(result.domains, currentSearchQuery);
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

  /**
   * Render split view tabs section
   */
  function renderSplitViewTabs(tabs) {
    splitViewTabs.innerHTML = tabs.map(tab => createTabItem(tab, true)).join('');
    attachTabClickListeners(splitViewTabs);
  }

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

    // Enable auto-group when manually grouping (for consistency)
    const settings = await sendMessage('loadSettings');
    settings.autoGroup = true;
    await sendMessage('saveSettings', { settings });

    await sendMessage('groupTabs');
    await loadSettings();
    await loadTabs();

    groupAllBtn.disabled = false;
    // Show success checkmark
    groupAllBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;

    // Revert to original icon after 2 seconds
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

    await sendMessage('ungroupTabs');

    // Reload settings to update toggle (auto-group is now disabled)
    await loadSettings();
    await loadTabs();

    ungroupAllBtn.disabled = false;
    // Show success checkmark
    ungroupAllBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;

    // Revert to original icon after 2 seconds
    setTimeout(() => {
      ungroupAllBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14"/>
        </svg>
      `;
    }, 2000);
  }

  /**
   * Handle auto-group toggle change
   */
  async function handleAutoGroupToggle() {
    const settings = await sendMessage('loadSettings');
    settings.autoGroup = autoGroupToggle.checked;
    await sendMessage('saveSettings', { settings });
  }

  /**
   * Find duplicate tabs
   */
  async function handleFindDuplicates() {
    const result = await sendMessage('findDuplicates');

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

    await sendMessage('closeDuplicates');
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
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
      const closedTabs = sessions.filter(s => s.tab).map(s => s.tab);

      if (closedTabs.length === 0) {
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

      recentlyClosedList.innerHTML = closedTabs.map(tab => {
        const validFavicon = tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://');
        return `
          <div class="tab-item" data-session-id="${tab.sessionId}" title="${escapeHtml(tab.title)}">
            ${validFavicon ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="">` : getFaviconPlaceholder()}
            <span class="tab-title">${escapeHtml(tab.title || 'Untitled')}</span>
            <button class="restore-btn" data-session-id="${tab.sessionId}">Restore</button>
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
