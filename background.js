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

// ── Tracked state (in-memory mirror, persisted to IndexedDB) ──
// Map of tabId -> nodeId for quick lookup
const tabToNode = new Map();

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

    // Tell content script to start tracking
    try {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_TRACKING' });
    } catch {
        // Content script might not be ready yet
    }

    // Notify side panel to refresh
    broadcastToSidePanel({ type: 'TREE_UPDATED' });

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

    // Tell content script to start tracking
    try {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_TRACKING' });
    } catch {
        // Content script might not be ready yet, retry after a delay
        setTimeout(async () => {
            try {
                await chrome.tabs.sendMessage(tab.id, { type: 'START_TRACKING' });
            } catch { /* give up */ }
        }, 1000);
    }

    broadcastToSidePanel({ type: 'TREE_UPDATED' });
    console.log('[AI Tree] Child node created:', nodeId, 'parent:', parentNodeId);
    return node;
}

// ── Tab event listeners ──

// Detect tab creation (especially duplication)
chrome.tabs.onCreated.addListener(async (tab) => {
    // If this tab was opened from a tracked tab, create a child node
    if (tab.openerTabId && tabToNode.has(tab.openerTabId)) {
        // Wait a moment for the tab to fully initialize
        setTimeout(async () => {
            try {
                const updatedTab = await chrome.tabs.get(tab.id);
                await createChildNode(updatedTab, tab.openerTabId);
            } catch {
                // Tab may have been closed already
            }
        }, 500);
    }
});

// Update node title/URL when tab navigates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!tabToNode.has(tabId)) return;

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
        changed = true;
    }

    if (changed) {
        await TreeStorage.saveNode(node);
        broadcastToSidePanel({ type: 'TREE_UPDATED' });
    }

    // Snapshot reliability: re-send START_TRACKING when tab finishes loading
    // This fixes missing snapshots for duplicated tabs where content script wasn't ready
    if (changeInfo.status === 'complete') {
        try {
            await chrome.tabs.sendMessage(tabId, { type: 'START_TRACKING' });
        } catch {
            // Content script not ready, will retry on next update
        }
    }
});

// ── Active tab tracking ──

chrome.tabs.onActivated.addListener((activeInfo) => {
    broadcastToSidePanel({ type: 'TAB_ACTIVATED', tabId: activeInfo.tabId });
});

// Handle tab close
chrome.tabs.onRemoved.addListener(async (tabId) => {
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

    if (message.type === 'DELETE_NODE') {
        handleDeleteNode(message.nodeId, message.withChildren || false).then(() => {
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

async function handleSnapshotData(tabId, data, reason) {
    const nodeId = tabToNode.get(tabId);
    if (!nodeId) return;

    // Get previous snapshot BEFORE overwriting (for diff-based auto-naming)
    let previousText = null;
    try {
        const prevSnapshot = await TreeStorage.getSnapshot(nodeId);
        if (prevSnapshot) previousText = prevSnapshot.text;
    } catch { /* no previous snapshot */ }

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

    // Auto-naming: skip if user set a manual label
    const node = await TreeStorage.getNode(nodeId);
    if (node && !node.label) {
        let newAutoLabel = '';

        // Prioritize explicit new content detected by MutationObserver
        if (data.recentlyAdded) {
            const settings = await chrome.storage.local.get(['aiNamingType', 'aiApiUrl', 'aiApiKey', 'aiModel']);
            const namingType = settings.aiNamingType || 'builtin';

            // Use last 5000 chars of page text + recentlyAdded to ensure full context
            const fullContext = (data.text || '') + '\n' + (data.recentlyAdded || '');
            const apiContext = fullContext.slice(-5000);

            if (namingType === 'builtin') {
                // Built-in: use Cloudflare Worker proxy with model rotation
                try {
                    newAutoLabel = await generateTitleWithFallback(apiContext, null, BUILTIN_API_URL);
                } catch (e) {
                    console.error('[AI Tree] Built-in AI naming failed, falling back to local:', e);
                    newAutoLabel = extractLabelFromNewText(data.recentlyAdded);
                }
            } else if (namingType === 'custom' && settings.aiApiKey) {
                // Custom API: user-provided URL/key/model
                try {
                    const baseUrl = settings.aiApiUrl || 'https://api.openai.com/v1';
                    newAutoLabel = await generateTitleFromOpenAICompatible(
                        apiContext, settings.aiApiKey, settings.aiModel, baseUrl
                    );
                } catch (e) {
                    console.error('[AI Tree] Custom API naming failed, falling back to local:', e);
                    newAutoLabel = extractLabelFromNewText(data.recentlyAdded);
                }
            } else {
                // Local algorithm
                newAutoLabel = extractLabelFromNewText(data.recentlyAdded);
            }
        }

        // Fallback: if we simply have no auto-label yet (e.g. first load), try page text
        if (!newAutoLabel && !node.autoLabel) {
            newAutoLabel = extractAutoLabel(data.text);
        }

        // Only update if we found a meaningful new label
        if (newAutoLabel && newAutoLabel !== node.autoLabel) {
            node.autoLabel = newAutoLabel;
            await TreeStorage.saveNode(node);
            broadcastToSidePanel({ type: 'TREE_UPDATED' });
        }
    }

    console.log('[AI Tree] Snapshot saved for node', nodeId, 'reason:', reason);
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
    if (!tabToNode.has(tabId)) {
        await createRootNode(tab);
    }
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

        await TreeStorage.deleteNode(nodeId);
        await TreeStorage.deleteSnapshot(nodeId);
    }

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
                { role: "system", content: "Summarize the user's question into a concise title (max 15 characters). Ignore AI responses. Return ONLY the title, no quotes." },
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
