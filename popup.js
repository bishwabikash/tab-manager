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

  // Load settings and tabs on popup open
  await loadSettings();
  await loadTabs();

  // Event Listeners
  groupAllBtn.addEventListener('click', handleGroupAll);
  ungroupAllBtn.addEventListener('click', handleUngroupAll);
  autoGroupToggle.addEventListener('change', handleAutoGroupToggle);

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

    // Update tab count
    tabCount.textContent = `${result.totalTabs} tab${result.totalTabs !== 1 ? 's' : ''}`;

    // Handle split view tabs
    if (result.splitViewTabs && result.splitViewTabs.length > 0) {
      splitViewSection.style.display = 'block';
      renderSplitViewTabs(result.splitViewTabs);
    } else {
      splitViewSection.style.display = 'none';
    }

    // Render domain groups
    renderDomainGroups(result.domains);
  }

  /**
   * Render split view tabs section
   */
  function renderSplitViewTabs(tabs) {
    splitViewTabs.innerHTML = tabs.map(tab => createTabItem(tab, true)).join('');
    attachTabClickListeners(splitViewTabs);
  }

  /**
   * Render domain groups
   */
  function renderDomainGroups(domains) {
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

    domainList.innerHTML = domains.map(domain => `
      <div class="domain-group" data-domain="${escapeHtml(domain.name)}">
        <div class="domain-header">
          <div class="domain-info">
            <span class="domain-color color-${domain.color}"></span>
            <span class="domain-name">${escapeHtml(domain.name)}</span>
          </div>
          <span class="domain-count">${domain.tabs.length}</span>
        </div>
        <div class="domain-tabs">
          ${domain.tabs.map(tab => createTabItem(tab)).join('')}
        </div>
      </div>
    `).join('');

    // Attach click listeners
    attachTabClickListeners(domainList);
    attachDomainHeaderListeners();
  }

  /**
   * Create HTML for a single tab item
   */
  function createTabItem(tab, showSplitBadge = false) {
    const favicon = tab.favIconUrl
      ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="" onerror="this.style.display='none'">`
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

    return `
      <div class="tab-item ${activeClass}" data-tab-id="${tab.id}" title="${escapeHtml(tab.title)}">
        ${favicon}
        <span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span>
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
  }

  /**
   * Attach click listeners to domain headers for collapse
   */
  function attachDomainHeaderListeners() {
    document.querySelectorAll('.domain-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.parentElement;
        const tabs = group.querySelector('.domain-tabs');
        tabs.style.display = tabs.style.display === 'none' ? 'block' : 'none';
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
    groupAllBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      Group All Tabs
    `;
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
    ungroupAllBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12h14"/>
      </svg>
      Ungroup All
    `;
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
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
