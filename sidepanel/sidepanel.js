/**
 * sidepanel.js — Tree UI rendering and interaction logic
 */

// ── State ──
let treeNodes = [];
let expandedNodes = new Set();
let activeSnapshotNodeId = null;
let activeTabId = null;

// ── DOM Refs ──
const treeContainer = document.getElementById('tree-container');
const emptyState = document.getElementById('empty-state');
const snapshotViewer = document.getElementById('snapshot-viewer');
const snapshotTitle = document.getElementById('snapshot-title');
const snapshotMeta = document.getElementById('snapshot-meta');
const snapshotContent = document.getElementById('snapshot-content');
const btnTrack = document.getElementById('btn-track');
const btnCloseSnapshot = document.getElementById('btn-close-snapshot');

// ── Initialize ──

async function init() {
    await loadTree();
    setupEventListeners();

    // Query active tab on panel open for immediate highlighting
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' }, (response) => {
        if (chrome.runtime.lastError) return; // background not ready
        if (response && response.success && response.tabId) {
            activeTabId = response.tabId;
            renderTree();
        }
    });
}

// ── Load tree data from background ──

async function loadTree() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_TREE' }, (response) => {
            if (chrome.runtime.lastError) {
                // Background not ready, retry later
                resolve();
                return;
            }
            if (response && response.success) {
                treeNodes = response.nodes || [];
            }
            renderTree();
            resolve();
        });
    });
}

// ── Build tree structure from flat list ──

function buildTreeHierarchy(nodes) {
    const map = new Map();
    const roots = [];

    // Index by id
    nodes.forEach(node => {
        map.set(node.id, { ...node, children: [] });
    });

    // Build parent-child
    nodes.forEach(node => {
        const treeNode = map.get(node.id);
        if (node.parentId && map.has(node.parentId)) {
            map.get(node.parentId).children.push(treeNode);
        } else {
            roots.push(treeNode);
        }
    });

    // Sort children by creation time
    function sortChildren(node) {
        node.children.sort((a, b) => a.createdAt - b.createdAt);
        node.children.forEach(sortChildren);
    }
    roots.sort((a, b) => a.createdAt - b.createdAt);
    roots.forEach(sortChildren);

    return roots;
}

// ── Render tree ──

function renderTree() {
    if (treeNodes.length === 0) {
        emptyState.style.display = '';
        treeContainer.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    treeContainer.style.display = '';

    const roots = buildTreeHierarchy(treeNodes);
    treeContainer.innerHTML = '';

    roots.forEach(root => {
        treeContainer.appendChild(createNodeElement(root));
    });
}

// ── Create a node DOM element ──

function createNodeElement(node) {
    const div = document.createElement('div');
    div.className = 'tree-node';
    div.dataset.nodeId = node.id;

    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const displayLabel = node.label || '';
    const displayTitle = node.title || 'Untitled';
    const timeAgo = getTimeAgo(node.createdAt);

    // Node row
    const row = document.createElement('div');
    row.className = 'node-row' + (node.status === 'live' && node.tabId === activeTabId ? ' active' : '');

    // Toggle arrow
    const toggle = document.createElement('span');
    toggle.className = 'node-toggle' + (hasChildren ? (isExpanded ? ' expanded' : '') : ' leaf');
    toggle.textContent = '▶';
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExpand(node.id);
    });

    // Status dot
    const status = document.createElement('span');
    status.className = 'node-status ' + node.status;
    status.title = node.status === 'live' ? 'Tab is open' : 'Tab closed (snapshot available)';

    // Label
    const label = document.createElement('span');
    label.className = 'node-label';
    const effectiveLabel = displayLabel || node.autoLabel || '';
    if (effectiveLabel) {
        label.innerHTML = `<span class="custom-label">${escapeHtml(effectiveLabel)}</span><span class="page-title">${escapeHtml(truncate(displayTitle, 40))}</span>`;
    } else {
        label.innerHTML = `<span class="page-title">${escapeHtml(truncate(displayTitle, 50))}</span>`;
    }

    // Time
    const time = document.createElement('span');
    time.className = 'node-time';
    time.textContent = timeAgo;

    // Actions
    const actions = document.createElement('span');
    actions.className = 'node-actions';

    // Rename button
    const renameBtn = document.createElement('button');
    renameBtn.className = 'node-action-btn';
    renameBtn.title = 'Rename';
    renameBtn.innerHTML = '✏️';
    renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startRename(node, label);
    });

    // Snapshot button
    const snapBtn = document.createElement('button');
    snapBtn.className = 'node-action-btn';
    snapBtn.title = 'View snapshot';
    snapBtn.innerHTML = '📸';
    snapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewSnapshot(node.id);
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'node-action-btn danger';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNode(node.id);
    });

    actions.appendChild(renameBtn);
    actions.appendChild(snapBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(toggle);
    row.appendChild(status);
    row.appendChild(label);
    row.appendChild(time);
    row.appendChild(actions);

    // Click handler — switch to tab or show snapshot
    row.addEventListener('click', () => {
        if (node.status === 'live') {
            switchToTab(node.tabId);
        } else {
            viewSnapshot(node.id);
        }
    });

    // Right-click for context menu
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, node);
    });

    div.appendChild(row);

    // Children
    if (hasChildren) {
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'tree-children';
        childrenDiv.style.display = isExpanded ? '' : 'none';
        node.children.forEach(child => {
            childrenDiv.appendChild(createNodeElement(child));
        });
        div.appendChild(childrenDiv);
    }

    return div;
}

// ── Expand/Collapse ──

function toggleExpand(nodeId) {
    if (expandedNodes.has(nodeId)) {
        expandedNodes.delete(nodeId);
    } else {
        expandedNodes.add(nodeId);
    }
    renderTree();
}

// ── Switch to tab ──

function switchToTab(tabId) {
    chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: tabId });
}

// ── View snapshot ──

async function viewSnapshot(nodeId) {
    activeSnapshotNodeId = nodeId;

    const node = treeNodes.find(n => n.id === nodeId);

    chrome.runtime.sendMessage({ type: 'GET_SNAPSHOT', nodeId: nodeId }, (response) => {
        if (chrome.runtime.lastError) return;
        if (!response || !response.success || !response.snapshot) {
            snapshotTitle.textContent = 'No snapshot available';
            snapshotMeta.textContent = '';
            snapshotContent.innerHTML = '<div class="text-view" style="color:var(--text-muted); text-align:center; padding-top:40px;">No snapshot has been captured yet for this tab.</div>';
            snapshotViewer.style.display = '';
            return;
        }

        const snap = response.snapshot;
        snapshotTitle.textContent = snap.title || (node ? node.title : 'Snapshot');
        snapshotMeta.textContent = `Captured ${formatTime(snap.capturedAt)} · ${snap.reason || 'manual'}`;

        // Default to HTML view
        showSnapshotHTML(snap.html, snap.styles);
        snapshotViewer.style.display = '';

        // Set up tab switching
        document.querySelectorAll('.snapshot-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.view === 'html') tab.classList.add('active');
        });
    });
}

function showSnapshotHTML(html, pageStyles) {
    snapshotContent.innerHTML = '';

    // ── Reader-mode cleanup ──
    // Strip scripts, event handlers, and non-content elements
    let cleanHtml = (html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '')
        .replace(/<button[\s\S]*?<\/button>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[\s\S]*?<\/aside>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
        .replace(/<input[^>]*>/gi, '')
        .replace(/<textarea[\s\S]*?<\/textarea>/gi, '')
        .replace(/<select[\s\S]*?<\/select>/gi, '')
        .replace(/\s(on\w+)\s*=\s*(["'])[\s\S]*?\2/gi, '');

    // Strip all class and style attributes for a clean slate
    cleanHtml = cleanHtml
        .replace(/\s+class\s*=\s*"[^"]*"/gi, '')
        .replace(/\s+class\s*=\s*'[^']*'/gi, '')
        .replace(/\s+style\s*=\s*"[^"]*"/gi, '')
        .replace(/\s+style\s*=\s*'[^']*'/gi, '')
        .replace(/\s+data-[\w-]+\s*=\s*"[^"]*"/gi, '')
        .replace(/\s+data-[\w-]+\s*=\s*'[^']*'/gi, '');

    if (!cleanHtml.trim()) {
        cleanHtml = '<p style="color:#888; text-align:center; padding:40px;">Empty page</p>';
    }

    // ── Reader-mode CSS ──
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const bg = isDark ? '#1a1a24' : '#fafafa';
    const fg = isDark ? '#d8d8e8' : '#2a2a3e';
    const muted = isDark ? '#7a7a9a' : '#6a6a8a';
    const border = isDark ? '#2a2a3e' : '#e0e0e8';
    const codeBg = isDark ? '#22223a' : '#f0f0f5';
    const accent = isDark ? '#7c9fff' : '#2563eb';

    const readerCSS = `
        *, *::before, *::after { box-sizing: border-box; }
        body {
            background: ${bg};
            color: ${fg};
            font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            font-size: 14px;
            line-height: 1.75;
            padding: 20px;
            max-width: 100%;
            word-wrap: break-word;
            overflow-wrap: break-word;
            margin: 0;
        }
        /* Collapse empty divs and deeply nested wrappers */
        div { margin: 0; padding: 0; }
        /* Headings */
        h1, h2, h3, h4, h5, h6 {
            margin: 1.2em 0 0.5em;
            line-height: 1.35;
            font-weight: 600;
        }
        h1 { font-size: 1.5em; border-bottom: 1px solid ${border}; padding-bottom: 0.3em; }
        h2 { font-size: 1.3em; }
        h3 { font-size: 1.1em; }
        /* Paragraphs & text */
        p { margin: 0.6em 0; }
        strong, b { font-weight: 600; }
        em, i { font-style: italic; }
        /* Lists */
        ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
        li { margin: 0.25em 0; }
        /* Code */
        pre, code {
            background: ${codeBg};
            border-radius: 6px;
            font-family: 'Consolas', 'Monaco', 'Menlo', monospace;
            font-size: 13px;
        }
        pre {
            padding: 14px 16px;
            overflow-x: auto;
            margin: 0.8em 0;
            border: 1px solid ${border};
            line-height: 1.5;
        }
        code { padding: 2px 6px; }
        pre code { padding: 0; background: none; border: none; font-size: inherit; }
        /* Links */
        a { color: ${accent}; text-decoration: none; }
        a:hover { text-decoration: underline; }
        /* Tables */
        table { border-collapse: collapse; margin: 0.8em 0; width: 100%; }
        td, th {
            border: 1px solid ${border};
            padding: 8px 12px;
            text-align: left;
        }
        th { font-weight: 600; background: ${codeBg}; }
        /* Blockquotes */
        blockquote {
            border-left: 3px solid ${accent};
            margin: 0.8em 0;
            padding: 6px 16px;
            color: ${muted};
            background: ${codeBg};
            border-radius: 0 6px 6px 0;
        }
        /* Images */
        img { max-width: 100%; height: auto; border-radius: 6px; margin: 0.5em 0; }
        /* Horizontal rules */
        hr { border: none; border-top: 1px solid ${border}; margin: 1.5em 0; }
        /* Hide empty elements */
        span:empty, div:empty, p:empty { display: none; }
        /* Reasonable spacing for generic divs with text */
        div:not(:empty) + div:not(:empty) { margin-top: 0.3em; }
    `;

    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${readerCSS}</style></head><body>${cleanHtml}</body></html>`;

    snapshotContent.appendChild(iframe);
}

function showSnapshotText(text) {
    snapshotContent.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'text-view';
    div.textContent = text || '(No text content)';
    snapshotContent.appendChild(div);
}

function closeSnapshot() {
    snapshotViewer.style.display = 'none';
    activeSnapshotNodeId = null;
    snapshotContent.innerHTML = '';
}

// ── Rename ──

function startRename(node, labelEl) {
    const currentLabel = node.label || node.title || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentLabel;

    labelEl.innerHTML = '';
    labelEl.appendChild(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        const newLabel = input.value.trim();
        chrome.runtime.sendMessage({
            type: 'RENAME_NODE',
            nodeId: node.id,
            label: newLabel,
        }, () => {
            if (chrome.runtime.lastError) return;
            loadTree();
        });
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finish();
        }
        if (e.key === 'Escape') {
            finished = true; // prevent blur from saving
            loadTree();
        }
    });

    input.addEventListener('blur', finish);
}

// ── Delete ──

function deleteNode(nodeId, withChildren = false) {
    const msg = withChildren
        ? 'Delete this node and ALL its children?'
        : 'Delete this node? (Children will be kept)';
    if (!confirm(msg)) return;

    chrome.runtime.sendMessage({ type: 'DELETE_NODE', nodeId: nodeId, withChildren: withChildren }, () => {
        if (chrome.runtime.lastError) return;
        loadTree();
    });
}

// ── Context menu ──

let activeContextMenu = null;

function showContextMenu(event, node) {
    closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    const items = [];

    if (node.status === 'live') {
        items.push({ label: '🔀 Switch to Tab', action: () => switchToTab(node.tabId) });
        items.push({
            label: '📸 Force Snapshot', action: () => {
                chrome.runtime.sendMessage({ type: 'FORCE_SNAPSHOT', tabId: node.tabId });
            }
        });
    }

    items.push({ label: '📷 View Snapshot', action: () => viewSnapshot(node.id) });
    items.push({
        label: '✏️ Rename', action: () => {
            const labelEl = document.querySelector(`[data-node-id="${node.id}"] .node-label`);
            if (labelEl) startRename(node, labelEl);
        }
    });
    items.push({ separator: true });
    items.push({ label: '🗑️ Delete Node', action: () => deleteNode(node.id, false) });
    items.push({ label: '🗑️ Delete with Children', action: () => deleteNode(node.id, true), danger: true });

    items.forEach(item => {
        if (item.separator) {
            const sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            menu.appendChild(sep);
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'context-menu-item' + (item.danger ? ' danger' : '');
        btn.textContent = item.label;
        btn.addEventListener('click', () => {
            closeContextMenu();
            item.action();
        });
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    activeContextMenu = menu;

    // Reposition if menu overflows viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = (event.clientX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (event.clientY - rect.height) + 'px';
    }

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', closeContextMenu, { once: true });
    }, 0);
}

function closeContextMenu() {
    if (activeContextMenu) {
        activeContextMenu.remove();
        activeContextMenu = null;
    }
}

// ── Event listeners ──

function setupEventListeners() {
    // Track button
    btnTrack.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.runtime.sendMessage({ type: 'START_TRACKING_TAB', tabId: tab.id }, () => {
                if (chrome.runtime.lastError) return;
                loadTree();
            });
        }
    });

    // Close snapshot
    btnCloseSnapshot.addEventListener('click', closeSnapshot);

    // Snapshot tab switching
    document.querySelectorAll('.snapshot-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.snapshot-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            if (!activeSnapshotNodeId) return;

            chrome.runtime.sendMessage({ type: 'GET_SNAPSHOT', nodeId: activeSnapshotNodeId }, (response) => {
                if (chrome.runtime.lastError) return;
                if (!response || !response.snapshot) return;
                if (tab.dataset.view === 'html') {
                    showSnapshotHTML(response.snapshot.html, response.snapshot.styles);
                } else {
                    showSnapshotText(response.snapshot.text);
                }
            });
        });
    });

    // Listen for tree updates and tab activation from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'TREE_UPDATED') {
            loadTree();
        }
        if (message.type === 'TAB_ACTIVATED') {
            activeTabId = message.tabId;
            renderTree();
        }
        // Always send a response to prevent "message port closed" error
        sendResponse({ received: true });
        return false;
    });
}

// ── Helpers ──

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
}

function getTimeAgo(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return days + 'd';
    if (hours > 0) return hours + 'h';
    if (minutes > 0) return minutes + 'm';
    return 'now';
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
}

// ── Settings ──

const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');

// Views
const settingsMain = document.getElementById('settings-main');
const settingsNaming = document.getElementById('settings-naming');
const settingsAppearance = document.getElementById('settings-appearance');
const settingsCustomApi = document.getElementById('settings-custom-api');

// Form elements
const settingNamingType = document.getElementById('setting-naming-type');
const settingApiUrl = document.getElementById('setting-api-url');
const settingApiKey = document.getElementById('setting-api-key');
const settingModel = document.getElementById('setting-model');
const settingTheme = document.getElementById('setting-theme');

// Buttons
const btnSaveNaming = document.getElementById('btn-save-naming');
const btnSaveAppearance = document.getElementById('btn-save-appearance');
const btnTestConnection = document.getElementById('btn-test-connection');
const btnConfigCustom = document.getElementById('btn-config-custom');
const btnSaveCustomApi = document.getElementById('btn-save-custom-api');

// ── Settings Navigation ──

function showSettingsView(viewId) {
    // Hide all views
    settingsMain.style.display = 'none';
    settingsNaming.style.display = 'none';
    settingsAppearance.style.display = 'none';
    if (settingsCustomApi) settingsCustomApi.style.display = 'none';
    // Show target
    const target = document.getElementById(viewId);
    if (target) target.style.display = 'flex';
}

function goBackToMain() {
    showSettingsView('settings-main');
}

function openSettings() {
    // Load all settings
    chrome.storage.local.get(['aiNamingType', 'aiApiUrl', 'aiApiKey', 'aiModel', 'theme'], (result) => {
        // Validate naming type (ensure it's one of the valid options)
        const validTypes = ['builtin', 'custom', 'local'];
        let namingType = result.aiNamingType || 'builtin';
        if (!validTypes.includes(namingType)) {
            namingType = 'builtin';
        }
        settingNamingType.value = namingType;

        settingApiUrl.value = result.aiApiUrl || 'https://api.openai.com/v1';
        settingApiKey.value = result.aiApiKey || '';
        settingModel.value = result.aiModel || 'gpt-3.5-turbo';
        settingTheme.value = result.theme || 'system';
        updateSettingsUI();
        // Always start at main menu
        showSettingsView('settings-main');
        settingsModal.style.display = 'flex';
    });
}

function closeSettings() {
    settingsModal.style.display = 'none';
}

function updateSettingsUI() {
    const type = settingNamingType.value;
    const builtinHint = document.getElementById('setting-builtin-hint');
    const localHint = document.getElementById('setting-local-hint');

    // Hide all conditional sections
    if (builtinHint) builtinHint.classList.add('hidden');
    if (localHint) localHint.classList.add('hidden');
    if (btnConfigCustom) btnConfigCustom.classList.add('hidden');

    if (type === 'custom') {
        if (btnConfigCustom) btnConfigCustom.classList.remove('hidden');
    } else if (type === 'builtin') {
        if (builtinHint) builtinHint.classList.remove('hidden');
    } else if (type === 'local') {
        if (localHint) localHint.classList.remove('hidden');
    }
}

// ── Save: Naming ──

function saveNamingSettings() {
    const namingType = settingNamingType.value;
    const settings = { aiNamingType: namingType };

    chrome.storage.local.set(settings, () => {
        goBackToMain();
    });
}

// ── Save: Appearance ──

function saveAppearanceSettings() {
    const theme = settingTheme.value;
    chrome.storage.local.set({ theme: theme }, () => {
        applyTheme(theme);
        goBackToMain();
    });
}

function saveCustomApiSettings() {
    const settings = {
        aiApiUrl: (settingApiUrl.value.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
        aiApiKey: settingApiKey.value.trim(),
        aiModel: settingModel.value.trim(),
        aiNamingType: 'custom'
    };
    settingNamingType.value = 'custom';

    chrome.storage.local.set(settings, () => {
        updateSettingsUI();
        showSettingsView('settings-naming');
    });
}

function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

// ── Test Connection ──

function testConnection() {
    const originalText = btnTestConnection.innerText;
    btnTestConnection.innerText = 'Testing...';
    btnTestConnection.disabled = true;

    const namingType = settingNamingType.value;
    let apiKey, baseUrl, model;

    if (namingType === 'custom') {
        apiKey = settingApiKey.value.trim();
        baseUrl = (settingApiUrl.value.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
        model = settingModel.value.trim();

        if (!apiKey) {
            alert('请先输入 API Key');
            resetButton();
            return;
        }
    }
    // For builtin mode, apiKey/baseUrl/model are handled by background.js

    chrome.runtime.sendMessage({
        type: 'TEST_API_CONNECTION',
        apiKey: apiKey || '',
        baseUrl: baseUrl || '',
        model: model || ''
    }, (response) => {
        if (chrome.runtime.lastError) {
            alert('Error: ' + chrome.runtime.lastError.message);
            resetButton();
            return;
        }

        if (response && response.success) {
            btnTestConnection.innerText = '连接成功 ✓';
            btnTestConnection.style.background = 'var(--green)';
            btnTestConnection.style.color = '#fff';
            setTimeout(resetButton, 2000);
        } else {
            alert('连接失败:\n' + (response ? response.error : 'Unknown error'));
            btnTestConnection.innerText = '连接失败 ✗';
            btnTestConnection.style.background = 'var(--red)';
            btnTestConnection.style.color = '#fff';
            setTimeout(resetButton, 2000);
        }
    });

    function resetButton() {
        btnTestConnection.innerText = originalText;
        btnTestConnection.disabled = false;
        btnTestConnection.style.background = '';
        btnTestConnection.style.color = '';
    }
}

// ── Settings Event Listeners ──

if (btnSettings) {
    btnSettings.addEventListener('click', openSettings);
    btnCloseSettings.addEventListener('click', closeSettings);

    // Menu items → navigate to sub-page
    document.querySelectorAll('.settings-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const target = item.dataset.target;
            if (target) showSettingsView(target);
        });
    });

    // Back buttons → return to main menu
    document.querySelectorAll('.settings-back').forEach(btn => {
        btn.addEventListener('click', goBackToMain);
    });

    // Close buttons in sub-views → close modal
    document.querySelectorAll('.btn-close-settings').forEach(btn => {
        btn.addEventListener('click', closeSettings);
    });

    if (btnSaveNaming) btnSaveNaming.addEventListener('click', saveNamingSettings);
    if (btnSaveAppearance) btnSaveAppearance.addEventListener('click', saveAppearanceSettings);
    if (btnTestConnection) btnTestConnection.addEventListener('click', testConnection);
    if (btnConfigCustom) btnConfigCustom.addEventListener('click', () => showSettingsView('settings-custom-api'));
    if (btnSaveCustomApi) btnSaveCustomApi.addEventListener('click', saveCustomApiSettings);

    // Back from Custom API view -> Naming settings
    document.querySelectorAll('.settings-back-to-naming').forEach(btn => {
        btn.addEventListener('click', () => showSettingsView('settings-naming'));
    });

    // Form change handlers
    settingNamingType.addEventListener('change', updateSettingsUI);

    // Instant theme preview
    if (settingTheme) {
        settingTheme.addEventListener('change', () => applyTheme(settingTheme.value));
    }

    // Click backdrop to close
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettings();
    });
}

// ── Start ──
// Initialize theme
chrome.storage.local.get(['theme'], (result) => {
    applyTheme(result.theme || 'system');
    init();
});
