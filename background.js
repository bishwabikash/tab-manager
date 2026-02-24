// Tab Manager Pro - Background Service Worker
// Handles tab grouping by domain and split view management

// Color palette for tab groups
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// Well-known domain mappings for better display names
const DOMAIN_NAMES = {
    'google': 'Google',
    'youtube': 'YouTube',
    'github': 'GitHub',
    'stackoverflow': 'Stack Overflow',
    'reddit': 'Reddit',
    'twitter': 'Twitter',
    'facebook': 'Facebook',
    'instagram': 'Instagram',
    'linkedin': 'LinkedIn',
    'amazon': 'Amazon',
    'netflix': 'Netflix',
    'spotify': 'Spotify',
    'microsoft': 'Microsoft',
    'apple': 'Apple',
    'discord': 'Discord',
    'slack': 'Slack',
    'notion': 'Notion',
    'figma': 'Figma',
    'dribbble': 'Dribbble',
    'medium': 'Medium',
    'dev': 'DEV',
    'twitch': 'Twitch',
    'pinterest': 'Pinterest',
    'wikipedia': 'Wikipedia',
    'quora': 'Quora'
};

/**
 * Extract a clean domain name from URL
 * @param {string} url - Full URL
 * @returns {string} Formatted domain name
 */
function getDomainName(url) {
    if (!url) return 'Other';

    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;

        // Handle special URLs
        if (hostname === 'newtab' || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
            return 'Chrome';
        }
        if (url.startsWith('edge://')) return 'Edge';
        if (url.startsWith('brave://')) return 'Brave';
        if (url.startsWith('about:')) return 'Browser';

        // Remove www prefix
        hostname = hostname.replace(/^www\./, '');

        // Extract the main domain parts
        const parts = hostname.split('.');

        // Handle common TLDs and get the main domain
        let mainDomain = '';
        if (parts.length >= 2) {
            // Check for multi-part TLDs like .co.uk, .com.au
            const lastTwo = parts.slice(-2).join('.');
            if (['co.uk', 'com.au', 'co.in', 'co.jp', 'com.br', 'co.nz'].includes(lastTwo)) {
                mainDomain = parts.length > 2 ? parts[parts.length - 3] : parts[0];
            } else {
                mainDomain = parts[parts.length - 2];
            }
        } else {
            mainDomain = parts[0];
        }

        // Check if we have a known display name
        const lowerDomain = mainDomain.toLowerCase();
        if (DOMAIN_NAMES[lowerDomain]) {
            return DOMAIN_NAMES[lowerDomain];
        }

        // Capitalize first letter
        return mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1).toLowerCase();
    } catch (e) {
        console.error('Error parsing URL:', e);
        return 'Other';
    }
}

/**
 * Get a consistent color for a domain based on hash
 * @param {string} domain - Domain name
 * @returns {string} Color name from GROUP_COLORS
 */
function getDomainColor(domain) {
    let hash = 0;
    for (let i = 0; i < domain.length; i++) {
        const char = domain.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    const index = Math.abs(hash) % GROUP_COLORS.length;
    return GROUP_COLORS[index];
}

/**
 * Group all tabs in the current window by domain
 * @param {number} windowId - Optional window ID (defaults to current window)
 */
async function groupTabsByDomain(windowId) {
    try {
        // Query all tabs in the specified window
        const tabs = await chrome.tabs.query({ windowId });

        // Skip pinned tabs and all browser-internal URLs
        const unpinnedTabs = tabs.filter(tab => {
            if (tab.pinned) return false;
            if (!tab.url) return false;
            if (tab.url.startsWith('chrome://')) return false;
            if (tab.url.startsWith('chrome-extension://')) return false;
            if (tab.url.startsWith('about:')) return false;
            if (tab.url.startsWith('edge://')) return false;
            if (tab.url.startsWith('brave://')) return false;
            return true;
        });

        // Organize tabs by domain
        const domainTabs = new Map();

        for (const tab of unpinnedTabs) {
            const domain = getDomainName(tab.url);
            // Skip internal browser pseudo-domains only
            if (!domain || domain === 'Chrome' ||
                domain === 'Browser' || domain === 'Edge' || domain === 'Brave') continue;
            if (!domainTabs.has(domain)) {
                domainTabs.set(domain, []);
            }
            domainTabs.get(domain).push(tab);
        }

        // Get existing groups in the window
        const existingGroups = await chrome.tabGroups.query({ windowId });
        const groupByTitle = new Map();
        for (const group of existingGroups) {
            if (group.title) {
                groupByTitle.set(group.title, group);
            }
        }

        // Create or update groups for each domain
        for (const [domain, domainTabsList] of domainTabs) {
            // Group all domains — even single-tab ones get a group label.
            // (original behaviour: < 1 never skipped anything since map only
            //  has entries with >= 1 tab; < 2 was an unnecessary regression)
            if (domainTabsList.length < 1) continue;

            const tabIds = domainTabsList.map(t => t.id);
            const color = getDomainColor(domain);

            // Check if a group with this title already exists — reuse it
            const existingGroup = groupByTitle.get(domain);

            if (existingGroup) {
                // Add tabs to existing group (title/color already set)
                await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
            } else {
                // Create new group — pass windowId explicitly via createProperties.
                const groupId = await chrome.tabs.group({
                    tabIds,
                    createProperties: { windowId }
                });
                console.log(`[TabManager] Created group ${groupId} for "${domain}" in window ${windowId}`);

                // Set title first — most important property
                try {
                    await chrome.tabGroups.update(groupId, { title: domain });
                    console.log(`[TabManager] Title set: "${domain}" on group ${groupId}`);
                } catch (titleErr) {
                    console.error(`[TabManager] FAILED title set for "${domain}" group ${groupId}:`, titleErr);
                }

                // Set color + collapsed separately (best-effort — won't block title)
                try {
                    await chrome.tabGroups.update(groupId, { color, collapsed: false });
                } catch (styleErr) {
                    console.warn(`[TabManager] Could not set color/collapsed for group ${groupId}:`, styleErr);
                }
            }
        }

        return { success: true, groupCount: domainTabs.size };
    } catch (error) {
        console.error('Error grouping tabs:', error);
        return { success: false, error: error.message };
    }
}


/**
 * Ungroup all tabs in the current window
 * Also disables auto-group to prevent immediate re-grouping
 * @param {number} windowId - Optional window ID
 */
async function ungroupAllTabs(windowId = chrome.windows.WINDOW_ID_CURRENT) {
    try {
        // Disable auto-group to prevent immediate re-grouping
        const settings = await loadSettings();
        settings.autoGroup = false;
        await saveSettings(settings);
        invalidateSettingsCache();

        const tabs = await chrome.tabs.query({ windowId });
        const groupedTabs = tabs.filter(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);

        for (const tab of groupedTabs) {
            await chrome.tabs.ungroup(tab.id);
        }

        return { success: true, message: 'Tabs ungrouped. Auto-group disabled.' };
    } catch (error) {
        console.error('Error ungrouping tabs:', error);
        return { success: false, error: error.message };
    }
}


/**
 * Get all tabs organized by domain
 * @param {number} windowId - Optional window ID
 * @returns {Object} Tabs organized by domain with split view info
 */
async function getOrganizedTabs(windowId = chrome.windows.WINDOW_ID_CURRENT) {
    try {
        const tabs = await chrome.tabs.query({ windowId });

        const domains = new Map();

        for (const tab of tabs) {
            // Skip all browser-internal URLs (Chrome, Brave, Edge, Firefox)
            if (tab.url && (
                tab.url.startsWith('chrome://') ||
                tab.url.startsWith('chrome-extension://') ||
                tab.url.startsWith('about:') ||
                tab.url.startsWith('edge://') ||
                tab.url.startsWith('brave://')
            )) {
                continue;
            }

            const domain = getDomainName(tab.url);

            const tabInfo = {
                id: tab.id,
                title: tab.title || 'New Tab',
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                active: tab.active,
                pinned: tab.pinned,
                groupId: tab.groupId
                // splitViewId removed — chrome.tabs.splitViewId API does not exist
            };

            if (!domains.has(domain)) {
                domains.set(domain, {
                    name: domain,
                    color: getDomainColor(domain),
                    tabs: []
                });
            }
            domains.get(domain).tabs.push(tabInfo);
        }

        // Convert to array and sort by tab count
        const domainList = Array.from(domains.values()).sort((a, b) => b.tabs.length - a.tabs.length);

        return {
            success: true,
            domains: domainList,
            totalTabs: tabs.length
        };
    } catch (error) {
        console.error('Error getting organized tabs:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Save user settings
 * @param {Object} settings - Settings to save
 */
async function saveSettings(settings) {
    await chrome.storage.local.set({ tabManagerSettings: settings });
}

/**
 * Load user settings
 * @returns {Object} User settings
 */
async function loadSettings() {
    const result = await chrome.storage.local.get('tabManagerSettings');
    return result.tabManagerSettings || {
        autoGroup: false,
        collapseByDefault: false,
        groupSingleTabs: false
    };
}

// Message listener for popup communication
// resolveWindowId: always return a real integer windowId
// WINDOW_ID_CURRENT (-2) is meaningless in a SW context — tabs.query returns empty.
async function resolveWindowId(windowId) {
    if (windowId && windowId !== chrome.windows.WINDOW_ID_CURRENT) return windowId;
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win.id;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        switch (request.action) {
            case 'groupTabs':
                sendResponse(await groupTabsByDomain(await resolveWindowId(request.windowId)));
                break;
            case 'ungroupTabs':
                sendResponse(await ungroupAllTabs(await resolveWindowId(request.windowId)));
                break;
            case 'getOrganizedTabs':
                sendResponse(await getOrganizedTabs(await resolveWindowId(request.windowId)));
                break;
            case 'saveSettings':
                await saveSettings(request.settings);
                sendResponse({ success: true });
                break;
            case 'loadSettings':
                sendResponse(await loadSettings());
                break;
            case 'findDuplicates':
                sendResponse(await findDuplicateTabs(await resolveWindowId(request.windowId)));
                break;
            case 'closeDuplicates':
                sendResponse(await closeDuplicateTabs(await resolveWindowId(request.windowId)));
                break;
            default:
                sendResponse({ error: 'Unknown action' });
        }
    })();
    return true; // Indicates async response
});

// Keyboard shortcut handlers
// Use getLastFocused() instead of WINDOW_ID_CURRENT
// WINDOW_ID_CURRENT is undefined in a background service worker context.
chrome.commands.onCommand.addListener(async (command) => {
    try {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        switch (command) {
            case 'group-all-tabs':
                await groupTabsByDomain(win.id);
                break;
            case 'ungroup-all-tabs':
                await ungroupAllTabs(win.id);
                break;
        }
    } catch (e) {
        console.error('Keyboard shortcut error:', e);
    }
});

/**
 * Find duplicate tabs (same URL)
 * @param {number} windowId - Optional window ID
 * @returns {Object} Duplicate tabs info
 */
async function findDuplicateTabs(windowId = chrome.windows.WINDOW_ID_CURRENT) {
    try {
        const tabs = await chrome.tabs.query({ windowId });
        const urlMap = new Map();

        // Count occurrences of each URL
        for (const tab of tabs) {
            if (!tab.url ||
                tab.url.startsWith('chrome://') ||
                tab.url.startsWith('chrome-extension://') ||
                tab.url.startsWith('about:') ||
                tab.url.startsWith('edge://') ||
                tab.url.startsWith('brave://')) {
                continue;
            }

            const url = tab.url;
            if (!urlMap.has(url)) {
                urlMap.set(url, { tabs: [], title: tab.title, favIconUrl: tab.favIconUrl });
            }
            urlMap.get(url).tabs.push(tab.id);
        }

        // Filter to only duplicates (more than one)
        const duplicates = [];
        for (const [url, data] of urlMap.entries()) {
            if (data.tabs.length > 1) {
                duplicates.push({
                    url,
                    title: data.title,
                    favIconUrl: data.favIconUrl,
                    count: data.tabs.length,
                    tabIds: data.tabs
                });
            }
        }

        return { success: true, duplicates };
    } catch (error) {
        console.error('Error finding duplicates:', error);
        return { success: false, error: error.message, duplicates: [] };
    }
}

/**
 * Close duplicate tabs (keep the first, close the rest)
 * @param {number} windowId - Optional window ID
 * @returns {Object} Result
 */
async function closeDuplicateTabs(windowId = chrome.windows.WINDOW_ID_CURRENT) {
    try {
        const result = await findDuplicateTabs(windowId);
        if (!result.success) return result;

        const tabsToClose = [];
        for (const dup of result.duplicates) {
            // Keep the first tab, close the rest
            tabsToClose.push(...dup.tabIds.slice(1));
        }

        if (tabsToClose.length > 0) {
            await chrome.tabs.remove(tabsToClose);
        }

        return { success: true, closedCount: tabsToClose.length };
    } catch (error) {
        console.error('Error closing duplicates:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// MEMORY-OPTIMIZED CONTINUOUS MONITORING
// ============================================

// Cached settings to avoid repeated storage reads
let cachedSettings = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 2000; // Cache settings for 2 seconds

async function getCachedSettings() {
    const now = Date.now();
    if (!cachedSettings || (now - settingsCacheTime) > SETTINGS_CACHE_TTL) {
        cachedSettings = await loadSettings();
        settingsCacheTime = now;
    }
    return cachedSettings;
}

// Invalidate cache when settings change
function invalidateSettingsCache() {
    cachedSettings = null;
    settingsCacheTime = 0;
}

// Single debounce timer (reuse instead of creating new ones)
let regroupDebounceTimer = null;

function debounceRegroup(windowId, delay = 100) {
    if (regroupDebounceTimer) {
        clearTimeout(regroupDebounceTimer);
    }
    regroupDebounceTimer = setTimeout(async () => {
        regroupDebounceTimer = null;
        const settings = await getCachedSettings();
        if (settings.autoGroup) {
            await groupTabsByDomain(windowId);
        }
    }, delay);
}

// Lightweight single-tab grouping
async function ensureTabGrouped(tab) {
    if (!tab || tab.pinned) return;

    // Skip all browser-internal URLs
    if (!tab.url) return;
    if (tab.url.startsWith('chrome://')) return;
    if (tab.url.startsWith('chrome-extension://')) return;
    if (tab.url.startsWith('about:')) return;
    if (tab.url.startsWith('edge://')) return;
    if (tab.url.startsWith('brave://')) return;

    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;

    const domain = getDomainName(tab.url);
    if (!domain || domain === 'Chrome' || domain === 'Other' ||
        domain === 'Browser' || domain === 'Edge' || domain === 'Brave') return;

    // Only process if tab is ungrouped
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;

    // Find existing group for this domain
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    const existingGroup = groups.find(g => g.title === domain);

    if (existingGroup) {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: existingGroup.id });
    } else {
        // Only create new group if multiple tabs share domain
        const allTabs = await chrome.tabs.query({ windowId: tab.windowId });
        const sameDomainTabs = allTabs.filter(t =>
            getDomainName(t.url) === domain && !t.pinned
        );

        if (sameDomainTabs.length > 1) {
            const tabIds = sameDomainTabs.map(t => t.id);
            // Pass createProperties.windowId explicitly — avoids SW "current window" ambiguity
            const groupId = await chrome.tabs.group({
                tabIds,
                createProperties: { windowId: tab.windowId }
            });
            try {
                await chrome.tabGroups.update(groupId, {
                    title: domain,
                    color: getDomainColor(domain),
                    collapsed: false
                });
            } catch (updateErr) {
                console.error(`[Tab Manager] ensureTabGrouped: Failed to set title "${domain}":`, updateErr);
            }
        }
    }
}

// Event listeners with cached settings check
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;

    if (changeInfo.url || changeInfo.status === 'complete') {
        debounceRegroup(tab.windowId, 50);
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;

    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        await ensureTabGrouped(tab);
    } catch (e) { /* Tab closed */ }
});

// onAttached: call ensureTabGrouped directly — tab already has a URL when this fires.
// Using setTimeout here was unsafe (service worker can terminate mid-callback in MV3).
chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;

    try {
        const tab = await chrome.tabs.get(tabId);
        await ensureTabGrouped(tab);
    } catch (e) { /* Tab closed */ }
});

chrome.tabs.onMoved.addListener(async (tabId, moveInfo) => {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;
    debounceRegroup(moveInfo.windowId, 100);
});

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
    const settings = await getCachedSettings();
    if (settings.autoGroup) {
        debounceRegroup(detachInfo.oldWindowId, 200);
    }
});

// ============================================
// SMART PERIODIC CHECK via chrome.alarms
// chrome.alarms survive service worker restarts.
// setInterval/clearInterval are reset when the SW wakes up again.
// ============================================

const ALARM_NAME = 'periodic-regroup';

async function runPeriodicCheck() {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) {
        // Settings changed while alarm was queued — just cancel and return.
        await chrome.alarms.clear(ALARM_NAME);
        return;
    }

    try {
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        for (const win of windows) {
            const tabs = await chrome.tabs.query({ windowId: win.id });

            // Quick check: any ungrouped tabs?
            const hasUngrouped = tabs.some(t =>
                !t.pinned &&
                t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
                getDomainName(t.url) !== 'Chrome' &&
                getDomainName(t.url) !== 'Other'
            );

            if (hasUngrouped) {
                await groupTabsByDomain(win.id);
            }
        }
    } catch (e) { /* Window/tab closed during check */ }
}

async function startPeriodicCheck() {
    // Avoid duplicate alarms
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (existing) return;
    // Minimum periodInMinutes is 0.5 (30 seconds) in MV3
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
    console.log('Tab Manager Pro: periodic alarm started (30s interval)');
}

async function stopPeriodicCheck() {
    await chrome.alarms.clear(ALARM_NAME);
    console.log('Tab Manager Pro: periodic alarm stopped');
}

// Handle alarm ticks
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        runPeriodicCheck();
    }
});

// ============================================
// LIFECYCLE MANAGEMENT
// ============================================

// Listen for settings changes
chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local' && changes.tabManagerSettings) {
        invalidateSettingsCache();
        const newSettings = changes.tabManagerSettings.newValue;

        if (newSettings?.autoGroup) {
            await startPeriodicCheck();
        } else {
            await stopPeriodicCheck();
        }
    }
});

// Extension install / update handler
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await saveSettings({
            autoGroup: true,
            collapseByDefault: false,
            groupSingleTabs: false
        });
        invalidateSettingsCache();

        // Start the periodic alarm on fresh install
        await startPeriodicCheck();

        // Group existing tabs
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        for (const win of windows) {
            await groupTabsByDomain(win.id);
        }
    } else if (details.reason === 'update') {
        // Re-register alarm on extension update (SW restarts on update)
        const settings = await getCachedSettings();
        if (settings.autoGroup) {
            await startPeriodicCheck();
        }
    }
});

// Initialize on service worker startup
// The alarm persists across SW restarts, but we re-register to be safe.
(async () => {
    const settings = await getCachedSettings();
    if (settings.autoGroup) {
        await startPeriodicCheck();
    }
})();

console.log('Tab Manager Pro loaded (memory-optimized)');
