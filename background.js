/**
 * background.js — Service Worker for AI Conversation Tree
 * 
 * Responsibilities:
 * 1. Track tab creation/duplication to build tree
 * 2. Detect tab close and update node status
 * 3. Relay snapshot data to IndexedDB
 * 4. Handle extension icon click (start tracking / open side panel)
 * 5. Periodic snapshot orchestration
 */

importScripts('storage.js');

// ── SiliconFlow Free Model Pool ──
// Used for built-in AI auto-naming via Cloudflare Worker proxy.
// Models are tried in order; on 429 rate limit, the next model is used.
const BUILTIN_API_URL = 'https://aichattree-api.czx-ai.workers.dev/v1';
const SILICONFLOW_MODELS = [
    'Qwen/Qwen3-8B',
    'THUDM/glm-4-9b-chat',
    'THUDM/GLM-Z1-9B-0414',
    'THUDM/GLM-4-9B-0414',
    'tencent/Hunyuan-MT-7B',
    'internlm/internlm2_5-7b-chat',
    'THUDM/GLM-4.1V-9B-Thinking',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B'
];
const modelCooldowns = new Map(); // modelId → timestamp when cooldown expires
const MODEL_COOLDOWN_MS = 60_000; // 60 seconds
const AI_NAMING_TIMEOUT_MS = 8_000; // 8 seconds timeout, then local fallback
const AUTO_NAME_MIN_INCREMENTAL_TEXT = 12;
const AUTO_NAME_MIN_FULL_TEXT = 80;
const AUTO_NAME_CONTEXT_TAIL_MAX_CHARS = 2500;
const AUTO_NAME_LATEST_CHUNK_MAX_CHARS = 1200;
const RECENT_ACTIVATION_WINDOW_MS = 12_000;
const TAB_OPEN_RESOLVE_WINDOW_MS = 2_500;
const PARENT_CONFIDENCE_THRESHOLD = 0.70;

// ── Tracked state (in-memory mirror, persisted to IndexedDB) ──
// Map of tabId -> nodeId for quick lookup
const tabToNode = new Map();
const tabCreationMeta = new Map(); // tabId -> { initialWasBlank, openedAt, windowId, openerTabId }
const tabTrackingLocks = new Set(); // tabIds currently being auto-tracked
const namingInFlight = new Map(); // nodeId -> Promise<string>
const recentWindowContext = new Map(); // windowId -> { lastActivatedTabId, lastActivatedAt, lastTrackedTabId, lastTrackedNodeId, lastTrackedUrl, lastTrackedAt }

// Generate unique IDs
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ── Initialize: load existing nodes from DB ──

async function initialize() {
    try {
        const nodes = await TreeStorage.getAllNodes();
        for (const node of nodes) {
            if (node.status === 'live') {
                // Check if tab still exists
                try {
                    await chrome.tabs.get(node.tabId);
                    tabToNode.set(node.tabId, node.id);
                } catch {
                    // Tab no longer exists, mark as closed
                    node.status = 'closed';
                    await TreeStorage.saveNode(node);
                }
            }
        }
        console.log('[AI Tree] Initialized with', nodes.length, 'nodes');
    } catch (e) {
        console.error('[AI Tree] Init error:', e);
    }
}

initialize();

// Note: Side panel opens via openPanelOnActionClick (line 350+).
// Tracking is initiated from the side panel's "Track Tab" button.

/**
 * Create a root node for a tab (no parent)
 */
async function createRootNode(tab) {
    const nodeId = generateId();
    const node = {
        id: nodeId,
        tabId: tab.id,
        parentId: null,
        title: tab.title || 'Untitled',
        url: tab.url || '',
        label: '', // user-defined label
        status: 'live',
        createdAt: Date.now(),
    };

    await TreeStorage.saveNode(node);
    tabToNode.set(tab.id, nodeId);

    // Ensure tracking is active even for tabs opened before extension reload.
    await startTrackingInTabWithRetry(tab.id, tab.url || '');

    // Notify side panel to refresh
    broadcastToSidePanel({ type: 'TREE_UPDATED' });
    scheduleInitialAutoNaming(nodeId);

    console.log('[AI Tree] Root node created:', nodeId, 'for tab', tab.id);
    return node;
}

/**
 * Create a child node (branched from parent tab)
 */
async function createChildNode(tab, parentTabId) {
    const parentNodeId = tabToNode.get(parentTabId);
    if (!parentNodeId) return null;

    const nodeId = generateId();
    const node = {
        id: nodeId,
        tabId: tab.id,
        parentId: parentNodeId,
        title: tab.title || 'Untitled',
        url: tab.url || '',
        label: '',
        status: 'live',
        createdAt: Date.now(),
    };

    await TreeStorage.saveNode(node);
    tabToNode.set(tab.id, nodeId);

    // Ensure tracking is active even for tabs opened before extension reload.
    await startTrackingInTabWithRetry(tab.id, tab.url || '');

    broadcastToSidePanel({ type: 'TREE_UPDATED' });
    scheduleInitialAutoNaming(nodeId);
    console.log('[AI Tree] Child node created:', nodeId, 'parent:', parentNodeId);
    return node;
}

function scheduleInitialAutoNaming(nodeId) {
    // First attempt quickly, second attempt as a reliability fallback.
    const delays = [1200, 5000];
    delays.forEach((delayMs) => {
        setTimeout(() => {
            triggerAutoNaming(nodeId, { force: true, source: 'track_initial' }).catch((e) => {
                console.warn('[AI Tree] Initial auto-naming failed:', e.message);
            });
        }, delayMs);
    });
}

function canInjectContentScript(url) {
    if (!url || typeof url !== 'string') return false;
    return !(
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('devtools://') ||
        url.startsWith('about:')
    );
}

async function ensureContentScriptReady(tabId, tabUrl) {
    if (!tabId) return false;
    try {
        const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        if (ping && ping.success) return true;
    } catch {
        // Content script missing or stale.
    }

    if (!canInjectContentScript(tabUrl)) {
        return false;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
    } catch {
        return false;
    }

    try {
        const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        return !!(ping && ping.success);
    } catch {
        return false;
    }
}

async function startTrackingInTab(tabId, tabUrl) {
    if (!tabId) return false;

    try {
        await chrome.tabs.sendMessage(tabId, { type: 'START_TRACKING' });
        return true;
    } catch {
        const ready = await ensureContentScriptReady(tabId, tabUrl || '');
        if (!ready) return false;
        try {
            await chrome.tabs.sendMessage(tabId, { type: 'START_TRACKING' });
            return true;
        } catch {
            return false;
        }
    }
}

async function startTrackingInTabWithRetry(tabId, tabUrl) {
    const started = await startTrackingInTab(tabId, tabUrl);
    if (started) return true;

    setTimeout(async () => {
        try {
            await startTrackingInTab(tabId, tabUrl);
        } catch {
            // Best effort only.
        }
    }, 1000);

    return false;
}

async function getContentWithInjectionFallback(tabId, tabUrl) {
    if (!tabId) return null;

    try {
        return await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT' });
    } catch {
        const ready = await ensureContentScriptReady(tabId, tabUrl || '');
        if (!ready) return null;
        try {
            return await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT' });
        } catch {
            return null;
        }
    }
}

function normalizeComparableUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const url = new URL(rawUrl);
        // Hash is often UI state and should not affect same-conversation matching.
        url.hash = '';
        return url.toString();
    } catch {
        return rawUrl;
    }
}

function shouldSkipAutoTrackUrl(rawUrl) {
    if (!rawUrl) return true;
    return (
        rawUrl === 'about:blank' ||
        rawUrl === 'chrome://newtab/' ||
        rawUrl.startsWith('chrome://') ||
        rawUrl.startsWith('chrome-extension://') ||
        rawUrl.startsWith('edge://') ||
        rawUrl.startsWith('devtools://')
    );
}

function isBlankLikeUrl(rawUrl) {
    if (!rawUrl) return true;
    return rawUrl === 'about:blank' || rawUrl === 'chrome://newtab/';
}

function tryAcquireAutoTrackLock(tabId) {
    if (!tabId) return false;
    if (tabTrackingLocks.has(tabId)) return false;
    tabTrackingLocks.add(tabId);
    return true;
}

function releaseAutoTrackLock(tabId) {
    if (!tabId) return;
    tabTrackingLocks.delete(tabId);
}

function addCandidateScore(candidates, tabId, score, reason) {
    if (!tabId || !tabToNode.has(tabId)) return;
    const current = candidates.get(tabId) || { score: 0, reasons: [] };
    current.score += score;
    if (reason) current.reasons.push(reason);
    candidates.set(tabId, current);
}

function updateRecentTrackedUrl(tabId, rawUrl) {
    if (!tabId) return;
    const normalized = normalizeComparableUrl(rawUrl || '');
    for (const [windowId, context] of recentWindowContext.entries()) {
        if (context.lastTrackedTabId === tabId) {
            context.lastTrackedUrl = normalized;
            recentWindowContext.set(windowId, context);
        }
    }
}

function clearRecentContextForTab(tabId) {
    if (!tabId) return;
    for (const [windowId, context] of recentWindowContext.entries()) {
        let changed = false;
        if (context.lastActivatedTabId === tabId) {
            context.lastActivatedTabId = null;
            context.lastActivatedAt = 0;
            changed = true;
        }
        if (context.lastTrackedTabId === tabId) {
            context.lastTrackedTabId = null;
            context.lastTrackedNodeId = null;
            context.lastTrackedUrl = '';
            context.lastTrackedAt = 0;
            changed = true;
        }
        if (changed) {
            if (!context.lastActivatedTabId && !context.lastTrackedTabId) {
                recentWindowContext.delete(windowId);
            } else {
                recentWindowContext.set(windowId, context);
            }
        }
    }
}

async function inferParentTabForManualOpen(tab, normalizedUrl) {
    if (!tab || !tab.id || !normalizedUrl) return null;

    const now = Date.now();
    const meta = tabCreationMeta.get(tab.id);
    const candidates = new Map();
    let openerCandidateTabId = null;
    let recentCandidateTabId = null;

    if (tab.openerTabId && tabToNode.has(tab.openerTabId)) {
        openerCandidateTabId = tab.openerTabId;
        addCandidateScore(candidates, tab.openerTabId, 0.55, 'opener_tracked');

        const openerNodeId = tabToNode.get(tab.openerTabId);
        const openerNode = openerNodeId ? await TreeStorage.getNode(openerNodeId) : null;
        if (openerNode) {
            const openerUrl = normalizeComparableUrl(openerNode.url || '');
            if (openerUrl && openerUrl === normalizedUrl) {
                addCandidateScore(candidates, tab.openerTabId, 0.20, 'opener_url_match');
            }
        }
    }

    const context = recentWindowContext.get(tab.windowId);
    if (context && context.lastTrackedTabId && tabToNode.has(context.lastTrackedTabId)) {
        const trackedAge = now - (context.lastTrackedAt || 0);
        if (trackedAge <= RECENT_ACTIVATION_WINDOW_MS) {
            recentCandidateTabId = context.lastTrackedTabId;
            addCandidateScore(candidates, context.lastTrackedTabId, 0.35, 'recent_tracked');
            if (context.lastTrackedUrl && context.lastTrackedUrl === normalizedUrl) {
                addCandidateScore(candidates, context.lastTrackedTabId, 0.20, 'recent_url_match');
            }
            const switchedAway = context.lastActivatedTabId && context.lastActivatedTabId !== context.lastTrackedTabId;
            const switchedAge = now - (context.lastActivatedAt || 0);
            if (switchedAway && switchedAge <= RECENT_ACTIVATION_WINDOW_MS) {
                addCandidateScore(candidates, context.lastTrackedTabId, -0.15, 'focus_switched');
            }
        }
    }

    if (meta && meta.initialWasBlank && recentCandidateTabId) {
        addCandidateScore(candidates, recentCandidateTabId, 0.10, 'blank_paste_hint');
    }

    if (meta && (now - (meta.openedAt || now)) > TAB_OPEN_RESOLVE_WINDOW_MS) {
        for (const [candidateTabId] of candidates.entries()) {
            addCandidateScore(candidates, candidateTabId, -0.10, 'stale_open_window');
        }
    }

    if (
        openerCandidateTabId &&
        recentCandidateTabId &&
        openerCandidateTabId !== recentCandidateTabId
    ) {
        addCandidateScore(candidates, openerCandidateTabId, -0.125, 'candidate_conflict');
        addCandidateScore(candidates, recentCandidateTabId, -0.125, 'candidate_conflict');
    }

    let best = null;
    for (const [candidateTabId, candidate] of candidates.entries()) {
        if (candidateTabId === tab.id || !tabToNode.has(candidateTabId)) continue;
        if (!best || candidate.score > best.score) {
            best = { tabId: candidateTabId, score: candidate.score, reasons: candidate.reasons };
        }
    }

    if (!best || best.score < PARENT_CONFIDENCE_THRESHOLD) {
        return null;
    }

    return best;
}

/**
 * Duplicate tabs should become child nodes.
 * Manual URL copy/paste usually starts from a blank new tab and should be root.
 */
async function maybeTrackDuplicateFromNavigation(tab, rawUrl) {
    if (!tab || !tab.id || tabToNode.has(tab.id)) return false;
    if (!tab.openerTabId || !tabToNode.has(tab.openerTabId)) return false;

    const meta = tabCreationMeta.get(tab.id);
    if (!meta || meta.initialWasBlank) return false;

    const normalizedUrl = normalizeComparableUrl(rawUrl || tab.url || tab.pendingUrl || '');
    if (!normalizedUrl || shouldSkipAutoTrackUrl(normalizedUrl)) return false;

    let openerUrl = '';
    try {
        const openerTab = await chrome.tabs.get(tab.openerTabId);
        openerUrl = normalizeComparableUrl(openerTab.url || openerTab.pendingUrl || '');
    } catch {
        return false;
    }

    if (!openerUrl || normalizedUrl !== openerUrl) return false;
    if (!tryAcquireAutoTrackLock(tab.id)) return false;

    try {
        const childTab = { ...tab, url: rawUrl || tab.url || '' };
        await createChildNode(childTab, tab.openerTabId);
        tabCreationMeta.delete(tab.id);
        return true;
    } finally {
        releaseAutoTrackLock(tab.id);
    }
}

/**
 * For manually opened tabs with the same URL as tracked conversations:
 * infer parent with high confidence, otherwise create as root.
 */
async function maybeCreateRootNodeFromTrackedUrl(tab, rawUrl) {
    if (!tab || !tab.id || tabToNode.has(tab.id)) return false;
    if (!tryAcquireAutoTrackLock(tab.id)) return false;

    try {
        const normalizedUrl = normalizeComparableUrl(rawUrl || tab.url || tab.pendingUrl || '');
        if (!normalizedUrl || shouldSkipAutoTrackUrl(normalizedUrl)) return false;

        const nodes = await TreeStorage.getAllNodes();
        const hasTrackedMatch = nodes.some((node) => normalizeComparableUrl(node.url || '') === normalizedUrl);
        if (!hasTrackedMatch) return false;

        const inferredParent = await inferParentTabForManualOpen(tab, normalizedUrl);
        if (inferredParent && inferredParent.tabId && tabToNode.has(inferredParent.tabId)) {
            const childTab = { ...tab, url: rawUrl || tab.url || '' };
            await createChildNode(childTab, inferredParent.tabId);
            tabCreationMeta.delete(tab.id);
            console.log(
                '[AI Tree] Same-URL manual tab inferred as child:',
                tab.id,
                'parentTab:',
                inferredParent.tabId,
                'score:',
                inferredParent.score.toFixed(3),
                'reasons:',
                inferredParent.reasons.join(',')
            );
            return true;
        }

        const rootTab = { ...tab, url: rawUrl || tab.url || '' };
        await createRootNode(rootTab);
        tabCreationMeta.delete(tab.id);
        console.log('[AI Tree] Same-URL manual tab tracked as root:', tab.id);
        return true;
    } finally {
        releaseAutoTrackLock(tab.id);
    }
}

// ── Tab event listeners ──

// Detect tab duplication (only true duplicates, not just any new tab)
chrome.tabs.onCreated.addListener(async (tab) => {
    const initialUrl = tab.url || tab.pendingUrl || '';
    tabCreationMeta.set(tab.id, {
        initialWasBlank: isBlankLikeUrl(initialUrl) || shouldSkipAutoTrackUrl(initialUrl),
        openedAt: Date.now(),
        windowId: tab.windowId || null,
        openerTabId: tab.openerTabId || null,
    });

    // Duplicate detection pass (non-blank opener clone only)
    setTimeout(async () => {
        try {
            if (tabToNode.has(tab.id)) return;
            const updatedTab = await chrome.tabs.get(tab.id);
            const newUrl = updatedTab.url || updatedTab.pendingUrl || '';
            await maybeTrackDuplicateFromNavigation(updatedTab, newUrl);
        } catch {
            // Tab may be closed quickly.
        }
    }, 900);

    // Manual open flow: same-URL tabs become root nodes.
    setTimeout(async () => {
        try {
            if (tabToNode.has(tab.id)) return;
            const updatedTab = await chrome.tabs.get(tab.id);
            const newUrl = updatedTab.url || updatedTab.pendingUrl || tab.url || tab.pendingUrl || '';
            await maybeCreateRootNodeFromTrackedUrl(updatedTab, newUrl);
        } catch {
            // Tab may be closed quickly.
        }
    }, 1800);
});

// Update node title/URL when tab navigates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!tabToNode.has(tabId)) {
        if (changeInfo.url) {
            try {
                const trackedAsDuplicate = await maybeTrackDuplicateFromNavigation(tab, changeInfo.url);
                if (!trackedAsDuplicate) {
                    await maybeCreateRootNodeFromTrackedUrl(tab, changeInfo.url);
                }
            } catch (e) {
                console.error('[AI Tree] Failed to auto-track tab from URL update:', e);
            }
        }
        return;
    }

    const nodeId = tabToNode.get(tabId);
    const node = await TreeStorage.getNode(nodeId);
    if (!node) return;

    let changed = false;
    if (changeInfo.title && changeInfo.title !== node.title) {
        node.title = changeInfo.title;
        changed = true;
    }
    if (changeInfo.url && changeInfo.url !== node.url) {
        node.url = changeInfo.url;
        updateRecentTrackedUrl(tabId, changeInfo.url);
        changed = true;
    }

    if (changed) {
        await TreeStorage.saveNode(node);
        broadcastToSidePanel({ type: 'TREE_UPDATED' });
    }

    // Snapshot reliability: re-send START_TRACKING when tab finishes loading
    // This fixes missing snapshots for duplicated tabs where content script wasn't ready
    if (changeInfo.status === 'complete') {
        await startTrackingInTab(tabId, node.url || tab.url || '');
    }
});

// ── Active tab tracking ──

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    broadcastToSidePanel({ type: 'TAB_ACTIVATED', tabId: activeInfo.tabId });

    const now = Date.now();
    const windowId = activeInfo.windowId;
    const context = recentWindowContext.get(windowId) || {
        lastActivatedTabId: null,
        lastActivatedAt: 0,
        lastTrackedTabId: null,
        lastTrackedNodeId: null,
        lastTrackedUrl: '',
        lastTrackedAt: 0,
    };

    context.lastActivatedTabId = activeInfo.tabId;
    context.lastActivatedAt = now;

    if (tabToNode.has(activeInfo.tabId)) {
        const nodeId = tabToNode.get(activeInfo.tabId);
        let node = null;
        try {
            node = await TreeStorage.getNode(nodeId);
        } catch {
            node = null;
        }
        if (node) {
            context.lastTrackedTabId = activeInfo.tabId;
            context.lastTrackedNodeId = nodeId;
            context.lastTrackedUrl = normalizeComparableUrl(node.url || '');
            context.lastTrackedAt = now;
        }
    }

    recentWindowContext.set(windowId, context);
});

// Handle tab close
chrome.tabs.onRemoved.addListener(async (tabId) => {
    tabCreationMeta.delete(tabId);
    releaseAutoTrackLock(tabId);
    clearRecentContextForTab(tabId);
    if (!tabToNode.has(tabId)) return;

    const nodeId = tabToNode.get(tabId);
    const node = await TreeStorage.getNode(nodeId);
    if (node) {
        node.status = 'closed';
        node.closedAt = Date.now();
        await TreeStorage.saveNode(node);
    }

    tabToNode.delete(tabId);
    broadcastToSidePanel({ type: 'TREE_UPDATED' });
    console.log('[AI Tree] Tab closed, node marked closed:', nodeId);
});

// ── Message handling ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SNAPSHOT_DATA' && sender.tab) {
        handleSnapshotData(sender.tab.id, message.data, message.reason).then(() => {
            sendResponse({ success: true });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'GET_TREE') {
        TreeStorage.getAllNodes().then((nodes) => {
            sendResponse({ success: true, nodes: nodes });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'GET_SNAPSHOT') {
        TreeStorage.getSnapshot(message.nodeId).then((snapshot) => {
            sendResponse({ success: true, snapshot: snapshot });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'SWITCH_TO_TAB') {
        chrome.tabs.update(message.tabId, { active: true }).then(() => {
            chrome.tabs.get(message.tabId).then((tab) => {
                chrome.windows.update(tab.windowId, { focused: true });
            });
            sendResponse({ success: true });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'START_TRACKING_TAB') {
        handleStartTracking(message.tabId).then(() => {
            sendResponse({ success: true });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'RENAME_NODE') {
        handleRenameNode(message.nodeId, message.label).then(() => {
            sendResponse({ success: true });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'AUTO_NAME_NODE') {
        triggerAutoNaming(message.nodeId, { force: true, source: 'manual_auto_name' })
            .then((label) => {
                sendResponse({ success: true, label: label || '' });
            })
            .catch((e) => {
                sendResponse({ success: false, error: e.message });
            });
        return true;
    }

    if (message.type === 'DELETE_NODE') {
        handleDeleteNode(message.nodeId, message.withChildren || false).then(() => {
            sendResponse({ success: true });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'MOVE_NODE') {
        handleMoveNode(message.nodeId, message.newParentId || null).then(() => {
            sendResponse({ success: true });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'GET_ACTIVE_TAB') {
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
            sendResponse({ success: true, tabId: tab ? tab.id : null });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'FORCE_SNAPSHOT') {
        handleForceSnapshot(message.tabId).then(() => {
            sendResponse({ success: true });
        }).catch((e) => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    if (message.type === 'TEST_API_CONNECTION') {
        const testFn = message.apiKey
            ? generateTitleFromOpenAICompatible('test', message.apiKey, message.model, message.baseUrl)
            : generateTitleWithFallback('test', null, BUILTIN_API_URL);
        testFn
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((e) => {
                sendResponse({ success: false, error: e.message });
            });
        return true;
    }
});

// ── Handlers ──

function withTimeout(promise, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(timeoutMessage || 'Operation timed out'));
        }, timeoutMs);

        promise
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

function sanitizeGeneratedLabel(label) {
    if (!label) return '';
    return label
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^["']|["']$/g, '')
        .slice(0, 60);
}

function deriveLocalAutoLabel(incrementalText, fullText, fallbackTitle) {
    let candidate = '';
    if (incrementalText && incrementalText.trim().length > 0) {
        candidate = extractLabelFromNewText(incrementalText);
    }
    if (!candidate && fullText && fullText.trim().length > 0) {
        candidate = extractAutoLabel(fullText);
    }
    if (!candidate && fallbackTitle) {
        candidate = fallbackTitle.trim().slice(0, 40);
    }
    return sanitizeGeneratedLabel(candidate);
}

function isNoiseLine(line) {
    if (!line) return true;
    const text = line.trim();
    if (text.length < 2) return true;
    if (/^\d{1,2}:\d{2}/.test(text)) return true; // timestamps
    if (/^(Copy|Copy code|Edit|Share|Like|Dislike|More|Regenerate|Regenerate response|Retry|Search|Deep Research|You said|You asked|You)$/i.test(text)) return true;
    if (/^[\p{Emoji}\s]+$/u.test(text)) return true;
    return false;
}

function normalizeNamingText(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    return rawText.replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeTurnChunk(rawText, maxChars = AUTO_NAME_LATEST_CHUNK_MAX_CHARS) {
    const normalized = normalizeNamingText(rawText);
    if (!normalized) return '';
    const cleaned = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !isNoiseLine(line))
        .join('\n')
        .trim();
    if (!cleaned) return '';
    if (cleaned.length <= maxChars) return cleaned;
    return cleaned.slice(cleaned.length - maxChars).trim();
}

function splitMeaningfulParagraphs(rawText) {
    const normalized = normalizeNamingText(rawText);
    if (!normalized) return [];

    return normalized
        .split(/\n{2,}/)
        .map((paragraph) => sanitizeTurnChunk(paragraph, AUTO_NAME_LATEST_CHUNK_MAX_CHARS))
        .filter((paragraph) => paragraph.length > 0);
}

function looksLikeUserPromptText(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 260) return false;
    if (/[?？]$/.test(trimmed)) return true;
    if (/^(Q[:：]|问[:：]|用户[:：]|User[:：]|You[:：]|我[:：])/i.test(trimmed)) return true;
    if (/^(请|帮我|怎么|如何|为什么|给我|写一个|总结|解释|分析)/.test(trimmed)) return true;
    if (/^(what|how|why|can you|could you|please|write|summarize|explain|analyze)\b/i.test(trimmed)) return true;
    return false;
}

function chooseLatestAssistantChunk(paragraphs) {
    if (!paragraphs || paragraphs.length === 0) return '';
    for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
        const paragraph = paragraphs[i];
        // Prefer the freshest non-trivial paragraph instead of jumping too far back.
        if (paragraph.length >= 8) return paragraph;
    }
    return paragraphs[paragraphs.length - 1];
}

function chooseLatestUserChunk(paragraphs, assistantChunk) {
    if (!paragraphs || paragraphs.length === 0) return '';

    const assistantIndex = assistantChunk ? paragraphs.lastIndexOf(assistantChunk) : paragraphs.length - 1;
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
        const candidate = paragraphs[i];
        if (looksLikeUserPromptText(candidate)) return candidate;
    }
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
        const candidate = paragraphs[i];
        if (candidate.length <= 220) return candidate;
    }
    return '';
}

function extractLatestTurnForNaming(fullText, incrementalText) {
    const incrementalParagraphs = splitMeaningfulParagraphs(incrementalText);
    const fullParagraphs = splitMeaningfulParagraphs(fullText);
    const sourceParagraphs = incrementalParagraphs.length > 0 ? incrementalParagraphs : fullParagraphs;

    let latestAssistantChunk = chooseLatestAssistantChunk(sourceParagraphs);
    let latestUserChunk = chooseLatestUserChunk(sourceParagraphs, latestAssistantChunk);

    if (!latestAssistantChunk && fullParagraphs.length > 0) {
        latestAssistantChunk = chooseLatestAssistantChunk(fullParagraphs);
    }
    if (!latestUserChunk && fullParagraphs.length > 0) {
        latestUserChunk = chooseLatestUserChunk(fullParagraphs, latestAssistantChunk);
    }

    const contextSource = fullParagraphs.length > 0 ? fullParagraphs : incrementalParagraphs;
    const contextTail = contextSource
        .slice(-6)
        .join('\n\n')
        .slice(-AUTO_NAME_CONTEXT_TAIL_MAX_CHARS)
        .trim();

    return {
        latestAssistantChunk: sanitizeTurnChunk(latestAssistantChunk, AUTO_NAME_LATEST_CHUNK_MAX_CHARS),
        latestUserChunk: sanitizeTurnChunk(latestUserChunk, AUTO_NAME_LATEST_CHUNK_MAX_CHARS),
        contextTail: sanitizeTurnChunk(contextTail, AUTO_NAME_CONTEXT_TAIL_MAX_CHARS),
    };
}

function buildLatestFocusedPrompt(latestTurn) {
    const sections = [];
    if (latestTurn.latestAssistantChunk) {
        sections.push(`Latest assistant response:\n${latestTurn.latestAssistantChunk}`);
    }
    if (latestTurn.latestUserChunk) {
        sections.push(`Latest user request:\n${latestTurn.latestUserChunk}`);
    }
    if (latestTurn.contextTail) {
        sections.push(`Recent conversation context:\n${latestTurn.contextTail}`);
    }
    return sections.join('\n\n').slice(-5000);
}

function extractLabelFromTailText(text) {
    if (!text || text.trim().length === 0) return '';

    const lines = text.split(/\n/)
        .map((line) => line.trim())
        .filter((line) => !isNoiseLine(line));

    if (lines.length === 0) return '';

    let candidate = '';
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        if (line.length >= 4 && line.length <= 120) {
            candidate = line;
            break;
        }
    }
    if (!candidate) candidate = lines[lines.length - 1];

    candidate = candidate.replace(/^(You said|You asked|You|User|用户|问)[:：\s]*/i, '');

    const sentenceEnd = candidate.search(/[。！？.!?\n]/);
    if (sentenceEnd > 0 && sentenceEnd < 60) {
        candidate = candidate.substring(0, sentenceEnd + 1);
    }
    if (candidate.length > 50) {
        candidate = candidate.substring(0, 50) + '…';
    }
    return candidate;
}

function deriveLatestLocalAutoLabel(latestTurn, incrementalText, fullText, fallbackTitle) {
    const orderedSources = [
        latestTurn.latestAssistantChunk,
        latestTurn.latestUserChunk,
        incrementalText,
        latestTurn.contextTail,
    ];

    for (const source of orderedSources) {
        if (!source) continue;
        const candidate = extractLabelFromTailText(source) || extractLabelFromNewText(source);
        const normalized = sanitizeGeneratedLabel(candidate);
        if (normalized) return normalized;
    }

    return deriveLocalAutoLabel(incrementalText, fullText, fallbackTitle);
}

async function saveLiveSnapshotFromContent(node, content, reason) {
    if (!node || !content) return;
    const snapshot = {
        nodeId: node.id,
        html: content.html || '',
        styles: content.styles || '',
        text: content.text || '',
        title: content.title || node.title || '',
        url: content.url || node.url || '',
        capturedAt: content.capturedAt || Date.now(),
        reason: reason || 'auto_name',
    };
    await TreeStorage.saveSnapshot(snapshot);
}

async function collectNamingText(node, options = {}) {
    let fullText = (options.fullText || '').trim();
    const incrementalText = (options.incrementalText || '').trim();

    if (!fullText && node.status === 'live' && node.tabId) {
        const response = await getContentWithInjectionFallback(node.tabId, node.url || '');
        if (response && response.text) {
            fullText = (response.text || '').trim();
            // Keep snapshot freshness without waiting for the regular periodic capture.
            await saveLiveSnapshotFromContent(node, response, options.snapshotReason || 'auto_name');
        }
    }

    if (!fullText) {
        try {
            const snapshot = await TreeStorage.getSnapshot(node.id);
            fullText = snapshot && snapshot.text ? snapshot.text.trim() : '';
        } catch {
            fullText = '';
        }
    }

    if (!fullText && incrementalText) {
        fullText = incrementalText;
    }

    return { fullText, incrementalText };
}

async function setNodeNamingStatus(nodeId, status) {
    const node = await TreeStorage.getNode(nodeId);
    if (!node) return false;

    let changed = false;
    if (status === 'pending') {
        if (node.namingStatus !== 'pending') {
            node.namingStatus = 'pending';
            changed = true;
        }
    } else {
        if (node.namingStatus) {
            delete node.namingStatus;
            changed = true;
        }
    }

    if (changed) {
        await TreeStorage.saveNode(node);
        broadcastToSidePanel({ type: 'TREE_UPDATED' });
    }
    return changed;
}

async function runAutoNaming(nodeId, options = {}) {
    const node = await TreeStorage.getNode(nodeId);
    if (!node) throw new Error('Node not found');

    await setNodeNamingStatus(nodeId, 'pending');

    try {
        const namingText = await collectNamingText(node, options);
        let fullText = namingText.fullText;
        const incrementalText = namingText.incrementalText;
        const shouldUseIncremental = incrementalText.length >= AUTO_NAME_MIN_INCREMENTAL_TEXT;
        const needsInitialNaming = !node.autoLabel && fullText.length >= AUTO_NAME_MIN_FULL_TEXT;
        const latestTurn = extractLatestTurnForNaming(fullText, incrementalText);
        const latestPromptText = buildLatestFocusedPrompt(latestTurn);

        if (!options.force && !shouldUseIncremental && !needsInitialNaming) {
            return '';
        }

        let label = '';
        const hasConversationText = !!fullText;
        if (!hasConversationText) {
            label = deriveLatestLocalAutoLabel(latestTurn, incrementalText, '', node.title || '');
            if (!label) return '';
        } else {
            const settings = await chrome.storage.local.get(['aiNamingType', 'aiApiUrl', 'aiApiKey', 'aiModel']);
            const namingType = settings.aiNamingType || 'builtin';
            const promptText = latestPromptText || (
                shouldUseIncremental
                    ? `${fullText}\n${incrementalText}`.slice(-5000)
                    : fullText.slice(-5000)
            );

            if (namingType === 'builtin') {
                try {
                    label = await withTimeout(
                        generateTitleWithFallback(promptText, null, BUILTIN_API_URL),
                        AI_NAMING_TIMEOUT_MS,
                        'Built-in AI naming timeout'
                    );
                } catch (e) {
                    console.warn('[AI Tree] Built-in AI naming failed, using local fallback:', e.message);
                }
            } else if (namingType === 'custom' && settings.aiApiKey) {
                try {
                    const baseUrl = settings.aiApiUrl || 'https://api.openai.com/v1';
                    label = await withTimeout(
                        generateTitleFromOpenAICompatible(promptText, settings.aiApiKey, settings.aiModel, baseUrl),
                        AI_NAMING_TIMEOUT_MS,
                        'Custom AI naming timeout'
                    );
                } catch (e) {
                    console.warn('[AI Tree] Custom AI naming failed, using local fallback:', e.message);
                }
            }
        }

        label = sanitizeGeneratedLabel(label);
        if (!label) {
            label = deriveLatestLocalAutoLabel(latestTurn, incrementalText, fullText, node.title || '');
        }

        if (!label) {
            return '';
        }

        const latestNode = await TreeStorage.getNode(nodeId);
        if (!latestNode) {
            return '';
        }

        let changed = false;
        if (latestNode.autoLabel !== label) {
            latestNode.autoLabel = label;
            changed = true;
        }
        // Product decision: AI auto-name can overwrite manual label.
        if (latestNode.label) {
            latestNode.label = '';
            changed = true;
        }
        if (latestNode.namingStatus) {
            delete latestNode.namingStatus;
            changed = true;
        }

        if (changed) {
            await TreeStorage.saveNode(latestNode);
            broadcastToSidePanel({ type: 'TREE_UPDATED' });
        }

        return label;
    } finally {
        await setNodeNamingStatus(nodeId, null);
    }
}

function triggerAutoNaming(nodeId, options = {}) {
    if (!nodeId) return Promise.resolve('');
    if (namingInFlight.has(nodeId)) {
        return namingInFlight.get(nodeId);
    }

    const task = runAutoNaming(nodeId, options)
        .catch((e) => {
            console.warn('[AI Tree] Auto-naming failed for node', nodeId, e.message);
            return '';
        })
        .finally(() => {
            namingInFlight.delete(nodeId);
        });

    namingInFlight.set(nodeId, task);
    return task;
}

async function handleSnapshotData(tabId, data, reason) {
    const nodeId = tabToNode.get(tabId);
    if (!nodeId) return;

    // Get previous snapshot BEFORE overwriting (for diff-based auto-naming)
    let previousText = null;
    try {
        const prevSnapshot = await TreeStorage.getSnapshot(nodeId);
        if (prevSnapshot) previousText = prevSnapshot.text;
    } catch {
        // No previous snapshot.
    }

    const snapshot = {
        nodeId: nodeId,
        html: data.html,
        styles: data.styles || '',
        text: data.text,
        title: data.title,
        url: data.url,
        capturedAt: data.capturedAt || Date.now(),
        reason: reason,
    };

    await TreeStorage.saveSnapshot(snapshot);

    const node = await TreeStorage.getNode(nodeId);
    if (!node) {
        return;
    }

    // Prefer explicit mutation text; fallback to snapshot text diff so labels
    // can still update when a site's DOM updates are hard to observe.
    const inferredAdded = extractIncrementalText(previousText || '', data.text || '');
    const newlyAddedText = [data.recentlyAdded || '', inferredAdded]
        .map((text) => text.trim())
        .filter((text) => text.length > 0)
        .join('\n');

    const hasMeaningfulDelta = newlyAddedText.length >= AUTO_NAME_MIN_INCREMENTAL_TEXT;
    const hasInitialText = (data.text || '').trim().length >= AUTO_NAME_MIN_FULL_TEXT;
    const shouldTrigger = hasMeaningfulDelta || (!node.autoLabel && hasInitialText) || reason === 'initial';

    if (shouldTrigger) {
        triggerAutoNaming(nodeId, {
            force: reason === 'initial',
            fullText: data.text || '',
            incrementalText: newlyAddedText,
            source: `snapshot:${reason}`,
        }).catch(() => {
            // Errors are logged inside triggerAutoNaming.
        });
    }

    console.log('[AI Tree] Snapshot saved for node', nodeId, 'reason:', reason);
}

function extractIncrementalText(previousText, currentText) {
    if (!previousText || !currentText) return '';
    if (previousText === currentText) return '';

    // Most common case: content is appended.
    if (currentText.startsWith(previousText)) {
        return currentText.slice(previousText.length).trim();
    }

    // Fallback: find overlapping suffix from previous text in current text.
    const maxWindow = Math.min(300, previousText.length);
    for (let size = maxWindow; size >= 40; size -= 20) {
        const suffix = previousText.slice(-size);
        const idx = currentText.lastIndexOf(suffix);
        if (idx !== -1) {
            const tail = currentText.slice(idx + suffix.length).trim();
            if (tail) return tail;
        }
    }

    return '';
}

/**
 * Extract a label from valid new text content (captured by MutationObserver).
 * We look for short, meaningful lines that look like user questions,
 * ignoring long AI responses and UI noise.
 */
function extractLabelFromNewText(text) {
    if (!text || text.trim().length === 0) return '';

    // Split into lines and clean up each line
    const lines = text.split(/\n/)
        .map(l => l.trim())
        .filter(l => {
            if (l.length < 2) return false;
            // Skip typical UI noise
            if (/^\d{1,2}:\d{2}/.test(l)) return false;         // timestamps
            // Expanded filter: button labels AND "You said" noise lines
            if (/^(Copy|Copy code|Edit|Share|Like|Dislike|More|Regenerate|Regenerate response|You said|You asked|You)$/i.test(l)) return false;
            if (/^[\p{Emoji}\s]+$/u.test(l)) return false;       // emoji-only
            return true;
        });

    if (lines.length === 0) return '';

    // Strategy 1: Look for the first "question-like" short line
    let candidate = '';

    for (const line of lines) {
        if (line.length >= 2 && line.length <= 80) {
            candidate = line;
            break;
        }
    }

    if (!candidate) {
        candidate = lines[0];
    }

    // NEW: Clean up prefixes like "You said" or "You:"
    // This handles "You said 评价李白" -> "评价李白"
    candidate = candidate.replace(/^(You said|You asked|You)[:\s]*/i, '');

    // Clean up the candidate: truncate at first punctuation
    const sentenceEnd = candidate.search(/[。！？.\n]/);
    if (sentenceEnd > 0 && sentenceEnd < 60) {
        candidate = candidate.substring(0, sentenceEnd + 1);
    }

    // Hard truncate if still too long
    if (candidate.length > 50) {
        candidate = candidate.substring(0, 50) + '…';
    }

    return candidate;
}

/**
 * Fallback auto-label for root nodes (no parent to diff against).
 * Extracts from the central portion of text, avoiding header and footer.
 */
function extractAutoLabel(text) {
    if (!text || text.trim().length === 0) return '';

    const allLines = text.split(/\n/)
        .map(l => l.trim())
        .filter(l => l.length > 15);

    if (allLines.length < 3) return '';

    // Skip first 10% (header/nav) and last 20% (footer/disclaimer)
    const startIdx = Math.floor(allLines.length * 0.1);
    const endIdx = Math.floor(allLines.length * 0.8);
    // Take a line from the middle-to-end of content zone
    const contentLines = allLines.slice(startIdx, endIdx);

    if (contentLines.length === 0) return '';

    // Take a line from the middle-to-end of content zone
    const pickIdx = Math.floor(contentLines.length * 0.7);
    let candidate = contentLines[pickIdx];

    const sentenceEnd = candidate.search(/[。！？.!?]/);
    if (sentenceEnd > 0 && sentenceEnd < 60) {
        candidate = candidate.substring(0, sentenceEnd + 1);
    }

    if (candidate.length > 40) {
        candidate = candidate.substring(0, 40) + '…';
    }

    return candidate;
}


async function handleStartTracking(tabId) {
    const tab = await chrome.tabs.get(tabId);

    // If already tracked as a child (e.g. onCreated auto-detected it),
    // remove the old mapping so we can create a fresh root node
    if (tabToNode.has(tabId)) {
        const existingNodeId = tabToNode.get(tabId);
        const existingNode = await TreeStorage.getNode(existingNodeId);
        // Only re-create as root if it was auto-created as a child
        if (existingNode && existingNode.parentId) {
            tabToNode.delete(tabId);
            // Clean up the auto-created child node
            await TreeStorage.deleteNode(existingNodeId);
        } else {
            await startTrackingInTabWithRetry(tabId, tab.url || existingNode?.url || '');
            // Already a root node: refresh naming immediately.
            triggerAutoNaming(existingNodeId, { force: true, source: 'track_existing_root' }).catch(() => { });
            return;
        }
    }

    await createRootNode(tab);
}

async function handleRenameNode(nodeId, label) {
    const node = await TreeStorage.getNode(nodeId);
    if (node) {
        node.label = label;
        await TreeStorage.saveNode(node);
        broadcastToSidePanel({ type: 'TREE_UPDATED' });
    }
}

async function handleDeleteNode(nodeId, withChildren) {
    const allNodes = await TreeStorage.getAllNodes();
    const targetNode = allNodes.find(n => n.id === nodeId);
    if (!targetNode) return;

    if (withChildren) {
        // Delete node and all descendants
        const toDelete = new Set();
        const queue = [nodeId];
        while (queue.length > 0) {
            const current = queue.shift();
            toDelete.add(current);
            for (const node of allNodes) {
                if (node.parentId === current && !toDelete.has(node.id)) {
                    queue.push(node.id);
                }
            }
        }

        for (const id of toDelete) {
            const node = allNodes.find(n => n.id === id);
            namingInFlight.delete(id);
            if (node && node.status === 'live') {
                tabToNode.delete(node.tabId);
                try { await chrome.tabs.remove(node.tabId); } catch { /* tab may not exist */ }
            }
            await TreeStorage.deleteNode(id);
            await TreeStorage.deleteSnapshot(id);
        }
    } else {
        // Delete only this node, promote children to parent
        for (const node of allNodes) {
            if (node.parentId === nodeId) {
                node.parentId = targetNode.parentId; // promote to grandparent
                await TreeStorage.saveNode(node);
            }
        }

        // Close the Chrome tab if live
        if (targetNode.status === 'live') {
            tabToNode.delete(targetNode.tabId);
            try { await chrome.tabs.remove(targetNode.tabId); } catch { /* tab may not exist */ }
        }

        namingInFlight.delete(nodeId);
        await TreeStorage.deleteNode(nodeId);
        await TreeStorage.deleteSnapshot(nodeId);
    }

    broadcastToSidePanel({ type: 'TREE_UPDATED' });
}

function collectDescendantIds(rootId, nodes) {
    const descendants = new Set();
    const queue = [rootId];
    while (queue.length > 0) {
        const current = queue.shift();
        for (const node of nodes) {
            if (node.parentId === current && !descendants.has(node.id)) {
                descendants.add(node.id);
                queue.push(node.id);
            }
        }
    }
    return descendants;
}

async function handleMoveNode(nodeId, newParentId) {
    const allNodes = await TreeStorage.getAllNodes();
    const movingNode = allNodes.find((node) => node.id === nodeId);
    if (!movingNode) {
        throw new Error('Node not found');
    }

    if (newParentId === nodeId) {
        throw new Error('Cannot move a node under itself');
    }

    if (newParentId) {
        const parentNode = allNodes.find((node) => node.id === newParentId);
        if (!parentNode) {
            throw new Error('Target parent not found');
        }
        const descendants = collectDescendantIds(nodeId, allNodes);
        if (descendants.has(newParentId)) {
            throw new Error('Cannot move a node under its descendant');
        }
    }

    const normalizedParentId = newParentId || null;
    if (movingNode.parentId === normalizedParentId) {
        return;
    }

    movingNode.parentId = normalizedParentId;
    await TreeStorage.saveNode(movingNode);
    broadcastToSidePanel({ type: 'TREE_UPDATED' });
}

async function handleForceSnapshot(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_SNAPSHOT' });
        if (response && response.success && response.data) {
            await handleSnapshotData(tabId, response.data, 'manual');
        }
    } catch {
        console.warn('[AI Tree] Failed to request snapshot from tab', tabId);
    }
}

// ── Broadcast to side panel ──

function broadcastToSidePanel(message) {
    chrome.runtime.sendMessage(message).catch(() => {
        // Side panel might not be open
    });
}

// ── Enable side panel on all tabs ──

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });

// ── API Helpers ──

/**
 * Call an OpenAI-compatible chat completion endpoint.
 * @param {string} text - User text to summarize
 * @param {string|null} apiKey - API key (null for built-in proxy which injects its own)
 * @param {string} model - Model ID
 * @param {string} baseUrl - API base URL
 * @throws {RateLimitError} on HTTP 429
 */
async function generateTitleFromOpenAICompatible(text, apiKey, model, baseUrl) {
    const cleanBaseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${cleanBaseUrl}/chat/completions`;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: model || 'gpt-3.5-turbo',
            messages: [
                {
                    role: "system",
                    content: "Create a concise branch title (max 15 characters) for the MOST RECENT conversation turn. Prioritize the latest assistant response; if unavailable, use the latest user request. Use older context only to disambiguate. Return ONLY the title, no quotes."
                },
                { role: "user", content: text }
            ],
            max_tokens: 30
        })
    });

    if (response.status === 429) {
        throw new RateLimitError(`Rate limited (429) for model: ${model}`);
    }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'API Error');
    if (!data.choices || !data.choices.length || !data.choices[0].message) throw new Error('No content from API');

    const content = data.choices[0].message.content;
    if (!content) throw new Error('Empty content from API');

    let title = content.trim();
    return title.replace(/^["']|["']$/g, '').replace(/\.$/, '');
}

/** Custom error for 429 rate limits */
class RateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RateLimitError';
    }
}

/**
 * Try generating a title by iterating through the free model pool.
 * Skips models that are cooling down from recent 429 errors.
 * Falls back to local algorithm if all models fail.
 */
async function generateTitleWithFallback(text, apiKey, baseUrl) {
    const now = Date.now();

    for (const model of SILICONFLOW_MODELS) {
        // Skip models in cooldown
        const cooldownUntil = modelCooldowns.get(model);
        if (cooldownUntil && now < cooldownUntil) {
            console.log(`[AI Tree] Skipping ${model} (cooling down)`);
            continue;
        }

        try {
            const title = await generateTitleFromOpenAICompatible(text, apiKey, model, baseUrl);
            if (title) return title;
        } catch (e) {
            if (e instanceof RateLimitError) {
                console.warn(`[AI Tree] Rate limited on ${model}, cooling down 60s`);
                modelCooldowns.set(model, now + MODEL_COOLDOWN_MS);
                continue; // try next model
            }
            // Other errors: log and try next model too
            console.error(`[AI Tree] Error with ${model}:`, e.message);
            continue;
        }
    }

    // All models exhausted
    console.warn('[AI Tree] All models failed or cooling down, using local fallback');
    return ''; // caller will use local fallback
}
