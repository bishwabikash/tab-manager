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

const INTERNAL_URL_PREFIXES = [
    'chrome://', 'chrome-extension://', 'chrome-search://', 'devtools://',
    'about:', 'edge://', 'brave://'
];
const NON_GROUPABLE_DOMAINS = new Set(['Chrome', 'Browser', 'Edge', 'Brave', 'Other']);
const TAB_GROUP_ID_NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;

const DEFAULT_SETTINGS = {
    autoGroup: false,
    collapseByDefault: false,
    groupSingleTabs: false,
    autoCloseDuplicates: false,
    askForAddressBarTabs: false,
    theme: 'dark'
};

// Tabs opened as a New Tab page and then sent somewhere from the address bar
// (typed, history autofill, or a New Tab page shortcut) can be held back from
// auto-grouping until the user picks where they go. Kept in session storage
// because the service worker can stop between Ctrl+T and pressing Enter.
const NEW_TAB_URL = /^(chrome|brave|edge):\/\/(newtab|new-tab-page)\/?$|^about:newtab$|^chrome-search:\/\/local-ntp/;
const placement = { newTabs: new Set(), exempt: new Map() };
const placementReady = chrome.storage.session.get('placement').then(({ placement: saved }) => {
    for (const id of saved?.newTabs || []) placement.newTabs.add(id);
    for (const [id, state] of saved?.exempt || []) placement.exempt.set(id, state);
}).catch(() => { });

function savePlacement() {
    return chrome.storage.session.set({
        placement: { newTabs: [...placement.newTabs], exempt: [...placement.exempt] }
    });
}

function isInternalUrl(url) {
    return !url || INTERNAL_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

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

        if (hostname === 'newtab' || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
            return 'Chrome';
        }
        if (url.startsWith('edge://')) return 'Edge';
        if (url.startsWith('brave://')) return 'Brave';
        if (url.startsWith('about:')) return 'Browser';
        if (url.startsWith('file://')) return 'Local File';
        if (url.startsWith('data:') || url.startsWith('blob:')) return 'Other';

        hostname = hostname.replace(/^www\./, '');
        if (!hostname) return 'Other';
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')) return hostname;

        const parts = hostname.split('.');

        let mainDomain = '';
        if (parts.length >= 2) {
            const lastTwo = parts.slice(-2).join('.');
            if (['co.uk', 'com.au', 'co.in', 'co.jp', 'com.br', 'co.nz'].includes(lastTwo)) {
                mainDomain = parts.length > 2 ? parts[parts.length - 3] : parts[0];
            } else {
                mainDomain = parts[parts.length - 2];
            }
        } else {
            mainDomain = parts[0];
        }

        const lowerDomain = mainDomain.toLowerCase();
        if (DOMAIN_NAMES[lowerDomain]) {
            return DOMAIN_NAMES[lowerDomain];
        }

        return mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1).toLowerCase();
    } catch (e) {
        console.error('Error parsing URL:', e);
        return 'Other';
    }
}

/**
 * Domain a tab should be grouped under, or null if it must not be grouped.
 * @param {chrome.tabs.Tab} tab
 * @returns {string|null}
 */
function getGroupableDomain(tab) {
    if (tab.pinned || isInternalUrl(tab.url) || placement.exempt.has(tab.id)) return null;
    const domain = getDomainName(tab.url);
    return NON_GROUPABLE_DOMAINS.has(domain) ? null : domain;
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
        hash = hash & hash;
    }
    const index = Math.abs(hash) % GROUP_COLORS.length;
    return GROUP_COLORS[index];
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Serialises grouping work per window so concurrent events can't create
// duplicate groups for the same domain.
const windowLocks = new Map();
function withWindowLock(windowId, fn) {
    const prev = windowLocks.get(windowId) || Promise.resolve();
    const result = prev.then(fn);
    const tail = result.catch(() => { });
    windowLocks.set(windowId, tail);
    tail.then(() => {
        if (windowLocks.get(windowId) === tail) windowLocks.delete(windowId);
    });
    return result;
}

/**
 * Create a group and set its title. The short delay before the update works
 * around Chromium overwriting metadata set immediately after creation; it is
 * awaited so the title exists before the window lock is released.
 */
async function createDomainGroup(tabIds, domain) {
    const groupId = await chrome.tabs.group({ tabIds });
    await sleep(50);
    try {
        await chrome.tabGroups.update(groupId, {
            title: domain,
            color: getDomainColor(domain),
            collapsed: false
        });
    } catch (_) { }
    return groupId;
}

async function addToDomainGroup(tabs, group, domain) {
    const tabIds = tabs.filter(t => t.groupId !== group.id).map(t => t.id);
    try {
        if (tabIds.length > 0) {
            await chrome.tabs.group({ tabIds, groupId: group.id });
        }
        await chrome.tabGroups.update(group.id, { title: domain, color: getDomainColor(domain) });
    } catch (err) {
        if (!String(err).includes('No group')) throw err;
        console.warn(`[TabManager] Group ${group.id} for "${domain}" vanished. Falling back to new group.`);
        await createDomainGroup(tabs.map(t => t.id), domain);
    }
}

// ============================================
// BACKGROUND GROUP NAME FIXER
// The browser can blank group titles set right after creation. While
// auto-group is on, this re-applies names to groups left without a title.
// Groups the user has named are never touched.
// ============================================

/**
 * Determine the dominant domain for a set of tabs.
 * @param {chrome.tabs.Tab[]} tabs
 * @returns {{domain: string, color: string}|null}
 */
function getDominantDomain(tabs) {
    const counts = new Map();
    for (const tab of tabs) {
        const domain = getGroupableDomain({ ...tab, pinned: false });
        if (!domain) continue;
        counts.set(domain, (counts.get(domain) || 0) + 1);
    }
    let best = null;
    let bestCount = 0;
    for (const [domain, count] of counts) {
        if (count > bestCount) {
            best = domain;
            bestCount = count;
        }
    }
    return best ? { domain: best, color: getDomainColor(best) } : null;
}

/**
 * @param {number} windowId
 */
async function fixUnnamedGroups(windowId) {
    try {
        const settings = await getCachedSettings();
        if (!settings.autoGroup) return;

        const groups = await chrome.tabGroups.query({ windowId });
        const unnamed = groups.filter(g => !g.title || !g.title.trim());
        if (unnamed.length === 0) return;

        const allTabs = await chrome.tabs.query({ windowId });

        for (const group of unnamed) {
            const dominant = getDominantDomain(allTabs.filter(t => t.groupId === group.id));
            if (!dominant) continue;

            console.log(`[TabManager:Fixer] Group ${group.id}: (unnamed) → "${dominant.domain}"`);
            try {
                await chrome.tabGroups.update(group.id, {
                    title: dominant.domain,
                    color: dominant.color
                });
            } catch (updateErr) {
                console.warn(`[TabManager:Fixer] Could not update group ${group.id}:`, updateErr);
            }
        }
    } catch (e) {
        console.warn('[TabManager:Fixer] fixUnnamedGroups error:', e);
    }
}

const fixerTimers = new Map();
/**
 * @param {number} windowId
 * @param {number} delayMs - delay before running
 * @param {string} [pass='default'] - unique pass identifier so multiple
 *        scheduled sweeps (e.g. 500ms + 1500ms) don't cancel each other.
 */
function scheduleFixUnnamed(windowId, delayMs = 500, pass = 'default') {
    const key = `${windowId}:${pass}`;
    const existing = fixerTimers.get(key);
    if (existing) clearTimeout(existing);
    const timerId = setTimeout(async () => {
        fixerTimers.delete(key);
        await fixUnnamedGroups(windowId);
    }, delayMs);
    fixerTimers.set(key, timerId);
}

/**
 * Group all tabs in a window by domain
 * @param {number} windowId
 * @param {{onlyIfAutoGroup?: boolean}} [options] - for automatic triggers:
 *        re-check the setting once the lock is held, so work queued before
 *        auto-group was turned off does nothing.
 */
function groupTabsByDomain(windowId, { onlyIfAutoGroup = false } = {}) {
    return withWindowLock(windowId, async () => {
        if (onlyIfAutoGroup && !(await loadSettings()).autoGroup) {
            return { success: true, groupCount: 0, skipped: true };
        }
        return groupWindowByDomain(windowId);
    });
}

async function groupWindowByDomain(windowId) {
    try {
        await placementReady;
        const [tabs, existingGroups, settings] = await Promise.all([
            chrome.tabs.query({ windowId }),
            chrome.tabGroups.query({ windowId }),
            getCachedSettings()
        ]);
        const minGroupSize = settings.groupSingleTabs ? 1 : 2;

        const tabDomains = tabs.map(tab => [tab, getGroupableDomain(tab)]).filter(([, domain]) => domain);
        const domainNames = new Set(tabDomains.map(([, domain]) => domain));
        const groupTitleById = new Map(existingGroups.map(g => [g.id, g.title]));

        // Tabs in a group the user named (title is not a domain) are left alone.
        const isManaged = (tab) => {
            if (tab.groupId === TAB_GROUP_ID_NONE) return true;
            const title = groupTitleById.get(tab.groupId);
            return !title || domainNames.has(title);
        };

        const domainTabs = new Map();
        for (const [tab, domain] of tabDomains) {
            if (!isManaged(tab)) continue;
            if (!domainTabs.has(domain)) domainTabs.set(domain, []);
            domainTabs.get(domain).push(tab);
        }

        const groupByTitle = new Map();
        for (const group of existingGroups) {
            if (group.title) groupByTitle.set(group.title, group);
        }

        let groupCount = 0;
        for (const [domain, domainTabsList] of domainTabs) {
            const existingGroup = groupByTitle.get(domain);
            if (existingGroup) {
                await addToDomainGroup(domainTabsList, existingGroup, domain);
                groupCount++;
            } else if (domainTabsList.length >= minGroupSize) {
                const groupId = await createDomainGroup(domainTabsList.map(t => t.id), domain);
                console.log(`[TabManager] Created group ${groupId} for "${domain}" in window ${windowId}`);
                groupCount++;
            }
        }

        return { success: true, groupCount };
    } catch (error) {
        console.error('Error grouping tabs:', error);
        return { success: false, error: error.message };
    } finally {
        scheduleFixUnnamed(windowId, 500, 'post-group-1');
        scheduleFixUnnamed(windowId, 1500, 'post-group-2');
        scheduleFixUnnamed(windowId, 3000, 'post-group-3');
        scheduleFixUnnamed(windowId, 5000, 'post-group-4');
    }
}

async function groupAllWindows() {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const results = await Promise.all(windows.map(win => groupTabsByDomain(win.id)));
    return { success: results.every(r => r.success) };
}

/**
 * Ungroup all tabs in a window. Also disables auto-group to prevent
 * immediate re-grouping.
 * @param {number} windowId
 */
async function ungroupAllTabs(windowId) {
    try {
        const settings = await loadSettings();
        settings.autoGroup = false;
        await saveSettings(settings);
        invalidateSettingsCache();

        await withWindowLock(windowId, async () => {
            const tabs = await chrome.tabs.query({ windowId });
            const groupedTabIds = tabs.filter(tab => tab.groupId !== TAB_GROUP_ID_NONE).map(tab => tab.id);
            if (groupedTabIds.length > 0) {
                await chrome.tabs.ungroup(groupedTabIds);
            }
        });

        return { success: true, message: 'Tabs ungrouped. Auto-group disabled.' };
    } catch (error) {
        console.error('Error ungrouping tabs:', error);
        return { success: false, error: error.message };
    }
}

async function saveSettings(settings) {
    await chrome.storage.local.set({ tabManagerSettings: settings });
}

async function loadSettings() {
    const result = await chrome.storage.local.get('tabManagerSettings');
    return { ...DEFAULT_SETTINGS, ...(result.tabManagerSettings || {}) };
}

// WINDOW_ID_CURRENT (-2) is meaningless in a SW context — always resolve a real window.
async function resolveWindowId(windowId) {
    if (windowId && windowId !== chrome.windows.WINDOW_ID_CURRENT) return windowId;
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win.id;
}

async function handleMessage(request) {
    switch (request.action) {
        case 'groupTabs':
            return groupTabsByDomain(await resolveWindowId(request.windowId));
        case 'groupAllWindows':
            return groupAllWindows();
        case 'ungroupTabs':
            return ungroupAllTabs(await resolveWindowId(request.windowId));
        case 'saveSettings':
            await saveSettings(request.settings);
            return { success: true };
        case 'loadSettings':
            return loadSettings();
        case 'getPendingPlacement':
            return getPendingPlacement(await resolveWindowId(request.windowId));
        case 'placeTab':
            return placeTab(request.tabId, request.target);
        default:
            return { success: false, error: 'Unknown action' };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request)
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
});

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

// ============================================
// CONTINUOUS MONITORING
// ============================================

let cachedSettings = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 2000;

async function getCachedSettings() {
    const now = Date.now();
    if (!cachedSettings || (now - settingsCacheTime) > SETTINGS_CACHE_TTL) {
        cachedSettings = await loadSettings();
        settingsCacheTime = now;
    }
    return cachedSettings;
}

function invalidateSettingsCache() {
    cachedSettings = null;
    settingsCacheTime = 0;
}

const regroupDebounceTimers = new Map();

function debounceRegroup(windowId, delay = 100) {
    const existingTimer = regroupDebounceTimers.get(windowId);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    const timerId = setTimeout(async () => {
        regroupDebounceTimers.delete(windowId);
        await groupTabsByDomain(windowId, { onlyIfAutoGroup: true });
    }, delay);
    regroupDebounceTimers.set(windowId, timerId);
}

/**
 * Lightweight single-tab grouping. Tab state is re-read inside the window
 * lock because it may have changed while waiting.
 * @param {number} tabId
 */
async function ensureTabGrouped(tabId) {
    await placementReady;
    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;

    let tab;
    try {
        tab = await chrome.tabs.get(tabId);
    } catch (_) {
        return;
    }

    await withWindowLock(tab.windowId, async () => {
        const current = await loadSettings();
        if (!current.autoGroup) return;

        let fresh;
        try {
            fresh = await chrome.tabs.get(tabId);
        } catch (_) {
            return;
        }
        if (fresh.windowId !== tab.windowId || fresh.groupId !== TAB_GROUP_ID_NONE) return;

        const domain = getGroupableDomain(fresh);
        if (!domain) return;

        const [groups, allTabs] = await Promise.all([
            chrome.tabGroups.query({ windowId: fresh.windowId }),
            chrome.tabs.query({ windowId: fresh.windowId })
        ]);

        const existingGroup = groups.find(g => g.title === domain);
        if (existingGroup) {
            await addToDomainGroup([fresh], existingGroup, domain);
            return;
        }

        const sameDomainTabs = allTabs.filter(t =>
            t.groupId === TAB_GROUP_ID_NONE && getGroupableDomain(t) === domain
        );
        const minGroupSize = current.groupSingleTabs ? 1 : 2;
        if (sameDomainTabs.length >= minGroupSize) {
            await createDomainGroup(sameDomainTabs.map(t => t.id), domain);
        }
    }).catch(e => console.warn('[TabManager] ensureTabGrouped error:', e));
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const settings = await getCachedSettings();

    if (changeInfo.url && await holdForPlacement(tab, changeInfo.url, settings)) return;

    if (changeInfo.status === 'complete' && settings.autoCloseDuplicates) {
        if (await autoCloseDuplicateTab(tab)) return;
    }

    if (!settings.autoGroup) return;

    if (changeInfo.pinned === false) {
        await ensureTabGrouped(tabId);
        return;
    }

    if (changeInfo.url || changeInfo.status === 'complete') {
        debounceRegroup(tab.windowId, 50);
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await ensureTabGrouped(activeInfo.tabId);
});

chrome.tabs.onAttached.addListener(async (tabId) => {
    await ensureTabGrouped(tabId);
    updateBadge();
});

chrome.tabs.onMoved.addListener(async (tabId, moveInfo) => {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) return;
    debounceRegroup(moveInfo.windowId, 100);
});

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
    updateBadge();
    const settings = await getCachedSettings();
    if (settings.autoGroup) {
        debounceRegroup(detachInfo.oldWindowId, 200);
    }
});

// ============================================
// PERIODIC CHECK via chrome.alarms (survives SW restarts)
// ============================================

const ALARM_NAME = 'periodic-regroup';

async function runPeriodicCheck() {
    const settings = await getCachedSettings();
    if (!settings.autoGroup) {
        await chrome.alarms.clear(ALARM_NAME);
        return;
    }

    try {
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        for (const win of windows) {
            const tabs = await chrome.tabs.query({ windowId: win.id });
            const hasUngrouped = tabs.some(t =>
                t.groupId === TAB_GROUP_ID_NONE && getGroupableDomain(t)
            );

            if (hasUngrouped) {
                await groupTabsByDomain(win.id, { onlyIfAutoGroup: true });
            }

            await fixUnnamedGroups(win.id);
        }
    } catch (e) { /* Window/tab closed during check */ }
}

async function startPeriodicCheck() {
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (existing) return;
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
    console.log('Tab Manager Pro: periodic alarm started (30s interval)');
}

async function stopPeriodicCheck() {
    await chrome.alarms.clear(ALARM_NAME);
    console.log('Tab Manager Pro: periodic alarm stopped');
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        runPeriodicCheck();
    }
});

// ============================================
// LIFECYCLE MANAGEMENT
// ============================================

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local' && changes.tabManagerSettings) {
        invalidateSettingsCache();
        if (changes.tabManagerSettings.newValue?.autoGroup) {
            await startPeriodicCheck();
        } else {
            await stopPeriodicCheck();
        }
    }
});

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await saveSettings({ ...DEFAULT_SETTINGS });
        invalidateSettingsCache();
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    } else if (details.reason === 'update') {
        const settings = await getCachedSettings();
        if (settings.autoGroup) {
            await startPeriodicCheck();
        }
    }
});

(async () => {
    const settings = await getCachedSettings();
    if (settings.autoGroup) {
        await startPeriodicCheck();
    }
    await chrome.action.setBadgeBackgroundColor({ color: '#1c4587' });
    await updateBadge();
})();

chrome.tabGroups.onCreated.addListener((group) => {
    scheduleFixUnnamed(group.windowId, 300, 'on-created-1');
    scheduleFixUnnamed(group.windowId, 1000, 'on-created-2');
    scheduleFixUnnamed(group.windowId, 2000, 'on-created-3');
    scheduleFixUnnamed(group.windowId, 4000, 'on-created-4');
});

chrome.tabGroups.onUpdated.addListener((group) => {
    if (!group.title || group.title.trim() === '') {
        scheduleFixUnnamed(group.windowId, 200, 'on-cleared-1');
        scheduleFixUnnamed(group.windowId, 800, 'on-cleared-2');
        scheduleFixUnnamed(group.windowId, 2000, 'on-cleared-3');
    }
});

// ============================================
// EXTENSION ICON BADGE — tab count of the focused window
// chrome.action badges are global or per-tab; there is no per-window badge.
// ============================================

async function updateBadge() {
    try {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        const tabs = await chrome.tabs.query({ windowId: win.id });
        const text = tabs.length > 99 ? '99+' : String(tabs.length);
        await chrome.action.setBadgeText({ text });
    } catch (e) { /* No normal window */ }
}

chrome.tabs.onCreated.addListener(() => updateBadge());
chrome.tabs.onRemoved.addListener(() => updateBadge());

// ============================================
// ASK WHERE ADDRESS-BAR TABS GO
// ============================================

chrome.tabs.onCreated.addListener(async (tab) => {
    if (!NEW_TAB_URL.test(tab.pendingUrl || tab.url || '')) return;
    await placementReady;
    placement.newTabs.add(tab.id);
    await savePlacement();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    await placementReady;
    const wasNewTab = placement.newTabs.delete(tabId);
    const wasExempt = placement.exempt.delete(tabId);
    if (wasNewTab || wasExempt) await savePlacement();
});

// Chrome often prerenders an address-bar suggestion and swaps it in as a new
// tab, so the New Tab page we were tracking is replaced rather than navigated.
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
    await placementReady;
    if (!placement.newTabs.delete(removedTabId)) return;
    placement.newTabs.add(addedTabId);
    try {
        const tab = await chrome.tabs.get(addedTabId);
        await holdForPlacement(tab, tab.url || tab.pendingUrl || '', await getCachedSettings());
    } catch (_) {
        placement.newTabs.delete(addedTabId);
        await savePlacement();
    }
});

/**
 * Called when a tab's URL changes. If it was a New Tab page that is now
 * going to a website, hold it ungrouped and ask the user where it goes.
 * @returns {Promise<boolean>} true if the tab is now waiting for a choice
 */
async function holdForPlacement(tab, url, settings) {
    await placementReady;
    if (!placement.newTabs.has(tab.id) || NEW_TAB_URL.test(url)) return false;
    placement.newTabs.delete(tab.id);

    const ask = settings.askForAddressBarTabs && /^https?:/.test(url) &&
        !tab.pinned && tab.groupId === TAB_GROUP_ID_NONE;
    if (ask) placement.exempt.set(tab.id, 'pending');
    await savePlacement();
    if (!ask) return false;

    await chrome.action.setBadgeText({ tabId: tab.id, text: '?' }).catch(() => { });
    await chrome.action.openPopup({ windowId: tab.windowId }).catch(() => { });
    return true;
}

async function getPendingPlacement(windowId) {
    await placementReady;
    const [tabs, groups] = await Promise.all([
        chrome.tabs.query({ windowId }),
        chrome.tabGroups.query({ windowId })
    ]);
    const pending = tabs
        .filter(t => placement.exempt.get(t.id) === 'pending')
        .sort((a, b) => b.id - a.id)
        .map(t => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, domain: getDomainName(t.url) }));
    return {
        success: true,
        pending,
        groups: groups.map(g => ({ id: g.id, title: g.title || '', color: g.color }))
    };
}

/**
 * @param {number} tabId
 * @param {number|'site'|'none'} target - a tab group id, group by site, or keep ungrouped
 */
async function placeTab(tabId, target) {
    await placementReady;
    const tab = await chrome.tabs.get(tabId);

    if (target === 'none') {
        placement.exempt.set(tabId, 'ungrouped');
    } else {
        placement.exempt.delete(tabId);
    }
    await savePlacement();
    await chrome.action.setBadgeText({ tabId, text: null }).catch(() => { });

    if (typeof target === 'number') {
        await withWindowLock(tab.windowId, () => chrome.tabs.group({ tabIds: [tabId], groupId: target }));
    } else if (target === 'site') {
        await withWindowLock(tab.windowId, async () => {
            const domain = getGroupableDomain(tab);
            if (!domain) return;
            const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
            const existing = groups.find(g => g.title === domain);
            if (existing) {
                await addToDomainGroup([tab], existing, domain);
            } else {
                await createDomainGroup([tabId], domain);
            }
        });
    }
    return { success: true };
}
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) updateBadge();
});

// ============================================
// AUTO-CLOSE DUPLICATE TABS
// ============================================

const recentlyClosedByExtension = new Set();

/**
 * Close a tab that just finished loading a URL already open in another tab
 * of the same window. Focus moves to the existing tab only if the closed tab
 * was the active one.
 * @returns {Promise<boolean>} true if the tab was closed
 */
async function autoCloseDuplicateTab(tab) {
    if (!tab || tab.pinned || isInternalUrl(tab.url)) return false;
    if (recentlyClosedByExtension.has(tab.id)) return false;

    try {
        const allWindowTabs = await chrome.tabs.query({ windowId: tab.windowId });
        const existing = allWindowTabs.find(t =>
            t.id !== tab.id &&
            t.url === tab.url &&
            !t.pinned &&
            !recentlyClosedByExtension.has(t.id)
        );
        if (!existing) return false;

        recentlyClosedByExtension.add(tab.id);
        setTimeout(() => recentlyClosedByExtension.delete(tab.id), 3000);
        await chrome.tabs.remove(tab.id);
        if (tab.active) {
            await chrome.tabs.update(existing.id, { active: true }).catch(() => { });
        }
        return true;
    } catch (e) {
        console.warn('[TabManager] autoCloseDuplicateTab error:', e);
        return false;
    }
}

console.log('Tab Manager Pro loaded');
