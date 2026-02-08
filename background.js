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
async function groupTabsByDomain(windowId = chrome.windows.WINDOW_ID_CURRENT) {
    try {
        // Query all tabs in the specified window
        const tabs = await chrome.tabs.query({ windowId });

        // Skip pinned tabs and group the rest
        const unpinnedTabs = tabs.filter(tab => !tab.pinned);

        // Organize tabs by domain
        const domainTabs = new Map();

        for (const tab of unpinnedTabs) {
            const domain = getDomainName(tab.url);
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
            // Skip if only one tab (no need to group single tabs)
            if (domainTabsList.length < 1) continue;

            const tabIds = domainTabsList.map(t => t.id);
            const color = getDomainColor(domain);

            // Check if a group with this title already exists
            const existingGroup = groupByTitle.get(domain);

            if (existingGroup) {
                // Add tabs to existing group
                await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
            } else {
                // Create new group
                const groupId = await chrome.tabs.group({ tabIds });
                await chrome.tabGroups.update(groupId, {
                    title: domain,
                    color: color,
                    collapsed: false
                });
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
 * @param {number} windowId - Optional window ID
 */
async function ungroupAllTabs(windowId = chrome.windows.WINDOW_ID_CURRENT) {
    try {
        const tabs = await chrome.tabs.query({ windowId });
        const groupedTabs = tabs.filter(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);

        for (const tab of groupedTabs) {
            await chrome.tabs.ungroup(tab.id);
        }

        return { success: true };
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
        const splitViewTabs = [];

        for (const tab of tabs) {
            const domain = getDomainName(tab.url);

            const tabInfo = {
                id: tab.id,
                title: tab.title || 'New Tab',
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                active: tab.active,
                pinned: tab.pinned,
                groupId: tab.groupId,
                splitViewId: tab.splitViewId
            };

            // Check for split view (Chrome 145+)
            if (tab.splitViewId && tab.splitViewId !== chrome.tabs.SPLIT_VIEW_ID_NONE) {
                splitViewTabs.push(tabInfo);
            }

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
            splitViewTabs,
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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        switch (request.action) {
            case 'groupTabs':
                sendResponse(await groupTabsByDomain(request.windowId));
                break;
            case 'ungroupTabs':
                sendResponse(await ungroupAllTabs(request.windowId));
                break;
            case 'getOrganizedTabs':
                sendResponse(await getOrganizedTabs(request.windowId));
                break;
            case 'saveSettings':
                await saveSettings(request.settings);
                sendResponse({ success: true });
                break;
            case 'loadSettings':
                sendResponse(await loadSettings());
                break;
            default:
                sendResponse({ error: 'Unknown action' });
        }
    })();
    return true; // Indicates async response
});

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

    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;

    const domain = getDomainName(tab.url);
    if (domain === 'Chrome' || domain === 'Other') return;

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
            const groupId = await chrome.tabs.group({ tabIds });
            await chrome.tabGroups.update(groupId, {
                title: domain,
                color: getDomainColor(domain),
                collapsed: false
            });
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

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;

    setTimeout(async () => {
        try {
            const tab = await chrome.tabs.get(tabId);
            await ensureTabGrouped(tab);
        } catch (e) { /* Tab closed */ }
    }, 50);
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
// SMART PERIODIC CHECK (only when needed)
// ============================================

let periodicCheckInterval = null;

function stopPeriodicCheck() {
    if (periodicCheckInterval) {
        clearInterval(periodicCheckInterval);
        periodicCheckInterval = null;
    }
}

async function runPeriodicCheck() {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) {
        stopPeriodicCheck();
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

function startPeriodicCheck() {
    if (periodicCheckInterval) return;
    periodicCheckInterval = setInterval(runPeriodicCheck, 500);
}

// ============================================
// LIFECYCLE MANAGEMENT
// ============================================

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.tabManagerSettings) {
        invalidateSettingsCache();
        const newSettings = changes.tabManagerSettings.newValue;

        if (newSettings?.autoGroup) {
            startPeriodicCheck();
        } else {
            stopPeriodicCheck();
        }
    }
});

// Extension install handler
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await saveSettings({
            autoGroup: true,
            collapseByDefault: false,
            groupSingleTabs: false
        });
        invalidateSettingsCache();

        // Group existing tabs
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        for (const win of windows) {
            await groupTabsByDomain(win.id);
        }
    }
});

// Initialize on load
(async () => {
    const settings = await getCachedSettings();
    if (settings.autoGroup) {
        startPeriodicCheck();
    }
})();

console.log('Tab Manager Pro loaded (memory-optimized)');
