/**
 * sidepanel.js — Tree UI rendering and interaction logic
 */

// ── State ──
let treeNodes = [];
let expandedNodes = new Set();
let activeSnapshotNodeId = null;
let activeTabId = null;
let currentLanguage = 'en';
let draggingNodeId = null;
let currentDropTargetNodeId = null;

const I18N = {
    en: {
        appTitle: 'AI Chat Branch',
        trackTab: 'Track Tab',
        trackCurrentTabTitle: 'Track current tab',
        settingsTitle: 'Settings',
        emptyTitle: 'No tabs being tracked yet.',
        emptyHint: 'Click "Track Tab" to start tracking the current tab, then duplicate it to create branches.',
        snapshotTitle: 'Snapshot',
        snapshotVisual: 'Visual',
        snapshotText: 'Text',
        close: 'Close',
        mainSettingsTitle: 'Settings',
        menuNaming: 'Auto Naming Method',
        menuAppearance: 'Appearance',
        menuLanguage: 'Language',
        namingTitle: 'Auto Naming Method',
        namingDesc: 'Analyze the conversation automatically and generate concise labels for nodes.',
        namingTypeLabel: 'Naming Method',
        namingBuiltin: 'Built-in AI',
        namingCustom: 'Custom API',
        namingLocal: 'Local Algorithm',
        builtinHint: 'Use the built-in AI naming service with zero configuration.',
        localHint: 'Use local text analysis with no network request. Naming quality may be lower.',
        configApi: 'Configure API',
        save: 'Save',
        appearanceTitle: 'Appearance',
        languageTitle: 'Language',
        themeLabel: 'Theme',
        themeSystem: 'System',
        themeLight: 'Light',
        themeDark: 'Dark',
        languageLabel: 'Language',
        customTitle: 'Custom API',
        customHint: 'Supports OpenAI, SiliconFlow, and other OpenAI-compatible endpoints.',
        modelLabel: 'Model',
        testConnection: 'Test Connection',
        saveAndReturn: 'Save and Return',
        backToSettings: 'Back to settings',
        backToNaming: 'Back to naming settings',
        snapshotMissingTitle: 'No snapshot available',
        snapshotMissingBody: 'No snapshot has been captured yet for this tab.',
        snapshotCapturedAt: 'Captured {time}',
        snapshotReasonManual: 'manual',
        snapshotReasonInitial: 'initial',
        snapshotReasonPeriodic: 'periodic',
        snapshotReasonContentChange: 'content change',
        snapshotReasonHidden: 'tab hidden',
        snapshotReasonBeforeUnload: 'before unload',
        snapshotReasonAutoName: 'auto name refresh',
        untitled: 'Untitled',
        statusLive: 'Tab is open',
        statusClosed: 'Tab closed (snapshot available)',
        emptyPage: 'Empty page',
        noTextContent: '(No text content)',
        confirmDeleteWithChildren: 'Delete this node and ALL its children?',
        confirmDeleteKeepChildren: 'Delete this node? (Children will be kept)',
        menuSwitchTab: 'Switch to Tab',
        menuDuplicateTab: 'Duplicate Tab',
        menuViewSnapshot: 'View Snapshot',
        menuAutoName: 'Auto Name',
        namingInProgress: 'Naming...',
        menuDeleteNode: 'Delete Node',
        menuDeleteWithChildren: 'Delete with Children',
        testing: 'Testing...',
        testSuccess: 'Connected \u2713',
        testFailed: 'Failed \u2717',
        enterApiKeyFirst: 'Please enter an API key first.',
        runtimeErrorPrefix: 'Error',
        connectionFailed: 'Connection failed:\n{error}',
        unknownError: 'Unknown error',
        noActiveTab: 'No active tab found.',
        trackUnsupportedHttps: 'Only HTTPS pages can be tracked.',
        trackInjectionFailed: 'Could not inject page helper script. Refresh the page and try again.',
        permissionRequestFailed: 'Failed to request site permission.\n{error}',
        permissionDenied: 'Permission was not granted. This site was not tracked.',
        permissionNotice: 'AI Chat Branch needs access to this site to track branches.\n\nWhat is accessed:\n- Page/chat content on this site for branch tree, snapshots, and node positioning.\n\nHow data is handled:\n- Branch tree, snapshots, and settings are stored locally in your browser.\n- If Auto Naming is enabled, a recent snippet is sent to your selected naming API.\n\nIf you deny access, this site cannot be tracked.'
    },
    zh: {
        appTitle: 'AI Chat Branch',
        trackTab: '\u8ddf\u8e2a\u6807\u7b7e\u9875',
        trackCurrentTabTitle: '\u8ddf\u8e2a\u5f53\u524d\u6807\u7b7e\u9875',
        settingsTitle: '\u8bbe\u7f6e',
        emptyTitle: '\u8fd8\u6ca1\u6709\u8ddf\u8e2a\u7684\u6807\u7b7e\u9875\u3002',
        emptyHint: '\u70b9\u51fb\u201c\u8ddf\u8e2a\u6807\u7b7e\u9875\u201d\u5f00\u59cb\u8ddf\u8e2a\u5f53\u524d\u6807\u7b7e\u9875\uff0c\u7136\u540e\u590d\u5236\u5b83\u6765\u521b\u5efa\u5206\u652f\u3002',
        snapshotTitle: '\u5feb\u7167',
        snapshotVisual: '\u89c6\u89c9',
        snapshotText: '\u6587\u672c',
        close: '\u5173\u95ed',
        mainSettingsTitle: '\u8bbe\u7f6e',
        menuNaming: '\u81ea\u52a8\u547d\u540d\u65b9\u5f0f',
        menuAppearance: '\u754c\u9762\u5916\u89c2',
        menuLanguage: '\u8bed\u8a00',
        namingTitle: '\u81ea\u52a8\u547d\u540d\u65b9\u5f0f',
        namingDesc: '\u81ea\u52a8\u5206\u6790\u5bf9\u8bdd\u5185\u5bb9\uff0c\u4e3a\u6bcf\u4e2a\u8282\u70b9\u751f\u6210\u7b80\u77ed\u6807\u9898\u3002',
        namingTypeLabel: '\u547d\u540d\u65b9\u5f0f',
        namingBuiltin: '\u5185\u7f6e AI',
        namingCustom: '\u81ea\u5b9a\u4e49 API',
        namingLocal: '\u672c\u5730\u7b97\u6cd5',
        builtinHint: '\u4f7f\u7528\u5185\u7f6e AI \u670d\u52a1\u81ea\u52a8\u547d\u540d\uff0c\u65e0\u9700\u914d\u7f6e\u3002',
        localHint: '\u4f7f\u7528\u672c\u5730\u6587\u672c\u7b97\u6cd5\uff0c\u65e0\u9700\u8054\u7f51\uff0c\u4f46\u51c6\u786e\u5ea6\u53ef\u80fd\u8f83\u4f4e\u3002',
        configApi: '\u914d\u7f6e API',
        save: '\u4fdd\u5b58',
        appearanceTitle: '\u754c\u9762\u5916\u89c2',
        languageTitle: '\u8bed\u8a00',
        themeLabel: '\u4e3b\u9898',
        themeSystem: '\u8ddf\u968f\u7cfb\u7edf',
        themeLight: '\u6d45\u8272',
        themeDark: '\u6df1\u8272',
        languageLabel: '\u8bed\u8a00',
        customTitle: '\u81ea\u5b9a\u4e49 API',
        customHint: '\u652f\u6301 OpenAI\u3001SiliconFlow \u7b49 OpenAI \u517c\u5bb9\u63a5\u53e3\u3002',
        modelLabel: '\u6a21\u578b',
        testConnection: '\u6d4b\u8bd5\u8fde\u63a5',
        saveAndReturn: '\u4fdd\u5b58\u5e76\u8fd4\u56de',
        backToSettings: '\u8fd4\u56de\u8bbe\u7f6e',
        backToNaming: '\u8fd4\u56de\u547d\u540d\u8bbe\u7f6e',
        snapshotMissingTitle: '\u65e0\u53ef\u7528\u5feb\u7167',
        snapshotMissingBody: '\u8be5\u6807\u7b7e\u9875\u8fd8\u6ca1\u6709\u91c7\u96c6\u5230\u5feb\u7167\u3002',
        snapshotCapturedAt: '\u91c7\u96c6\u65f6\u95f4 {time}',
        snapshotReasonManual: '\u624b\u52a8',
        snapshotReasonInitial: '\u521d\u6b21',
        snapshotReasonPeriodic: '\u5b9a\u65f6',
        snapshotReasonContentChange: '\u5185\u5bb9\u53d8\u66f4',
        snapshotReasonHidden: '\u5207\u6362\u6807\u7b7e',
        snapshotReasonBeforeUnload: '\u5373\u5c06\u79bb\u5f00',
        snapshotReasonAutoName: '\u81ea\u52a8\u547d\u540d\u5237\u65b0',
        untitled: '\u672a\u547d\u540d',
        statusLive: '\u6807\u7b7e\u9875\u5df2\u6253\u5f00',
        statusClosed: '\u6807\u7b7e\u9875\u5df2\u5173\u95ed\uff08\u5feb\u7167\u53ef\u7528\uff09',
        emptyPage: '\u7a7a\u767d\u9875\u9762',
        noTextContent: '\uff08\u65e0\u6587\u672c\u5185\u5bb9\uff09',
        confirmDeleteWithChildren: '\u5220\u9664\u8be5\u8282\u70b9\u53ca\u6240\u6709\u5b50\u8282\u70b9\uff1f',
        confirmDeleteKeepChildren: '\u4ec5\u5220\u9664\u8be5\u8282\u70b9\uff1f\uff08\u5b50\u8282\u70b9\u4f1a\u4fdd\u7559\uff09',
        menuSwitchTab: '\u5207\u6362\u5230\u6807\u7b7e\u9875',
        menuDuplicateTab: '\u590d\u5236\u6807\u7b7e\u9875',
        menuViewSnapshot: '\u67e5\u770b\u5feb\u7167',
        menuAutoName: '\u81ea\u52a8\u547d\u540d',
        namingInProgress: '\u547d\u540d\u4e2d...',
        menuDeleteNode: '\u5220\u9664\u8282\u70b9',
        menuDeleteWithChildren: '\u5220\u9664\u53ca\u5b50\u8282\u70b9',
        testing: '\u6d4b\u8bd5\u4e2d...',
        testSuccess: '\u8fde\u63a5\u6210\u529f \u2713',
        testFailed: '\u8fde\u63a5\u5931\u8d25 \u2717',
        enterApiKeyFirst: '\u8bf7\u5148\u8f93\u5165 API Key\u3002',
        runtimeErrorPrefix: '\u9519\u8bef',
        connectionFailed: '\u8fde\u63a5\u5931\u8d25:\n{error}',
        unknownError: '\u672a\u77e5\u9519\u8bef',
        noActiveTab: '\u672a\u627e\u5230\u5f53\u524d\u6fc0\u6d3b\u7684\u6807\u7b7e\u9875\u3002',
        trackUnsupportedHttps: '\u53ea\u652f\u6301\u8ddf\u8e2a HTTPS \u9875\u9762\u3002',
        trackInjectionFailed: '\u65e0\u6cd5\u6ce8\u5165\u9875\u9762\u811a\u672c\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u540e\u91cd\u8bd5\u3002',
        permissionRequestFailed: '\u7533\u8bf7\u7ad9\u70b9\u6743\u9650\u5931\u8d25\uff1a\n{error}',
        permissionDenied: '\u672a\u6388\u4e88\u7ad9\u70b9\u6743\u9650\uff0c\u8be5\u7ad9\u70b9\u672a\u88ab\u8ddf\u8e2a\u3002',
        permissionNotice: 'AI Chat Branch \u9700\u8981\u5f53\u524d\u7ad9\u70b9\u7684\u8bbf\u95ee\u6743\u9650\u624d\u80fd\u8ddf\u8e2a\u5206\u652f\u3002\n\n\u4f1a\u8bfb\u53d6\u7684\u5185\u5bb9\uff1a\n- \u5f53\u524d\u7ad9\u70b9\u7684\u9875\u9762/\u5bf9\u8bdd\u5185\u5bb9\uff0c\u7528\u4e8e\u5206\u652f\u6811\u3001\u5feb\u7167\u4e0e\u8282\u70b9\u5b9a\u4f4d\u3002\n\n\u6570\u636e\u5904\u7406\u65b9\u5f0f\uff1a\n- \u5206\u652f\u6811\u3001\u5feb\u7167\u3001\u8bbe\u7f6e\u9ed8\u8ba4\u4fdd\u5b58\u5728\u4f60\u672c\u5730\u6d4f\u89c8\u5668\u4e2d\u3002\n- \u82e5\u542f\u7528\u81ea\u52a8\u547d\u540d\uff0c\u4f1a\u5c06\u6700\u65b0\u7247\u6bb5\u53d1\u9001\u7ed9\u4f60\u9009\u62e9\u7684\u547d\u540d API\u3002\n\n\u5982\u679c\u62d2\u7edd\u6388\u6743\uff0c\u5c06\u65e0\u6cd5\u8ddf\u8e2a\u8be5\u7ad9\u70b9\u3002'
    }
};

// ── DOM Refs ──
const treeContainer = document.getElementById('tree-container');
const emptyState = document.getElementById('empty-state');
const snapshotViewer = document.getElementById('snapshot-viewer');
const snapshotTitle = document.getElementById('snapshot-title');
const snapshotMeta = document.getElementById('snapshot-meta');
const snapshotContent = document.getElementById('snapshot-content');
const btnTrack = document.getElementById('btn-track');
const btnCloseSnapshot = document.getElementById('btn-close-snapshot');

function t(key, vars = {}) {
    const dict = I18N[currentLanguage] || I18N.en;
    const fallback = I18N.en[key] || key;
    let value = dict[key] || fallback;
    Object.entries(vars).forEach(([name, replacement]) => {
        value = value.replace(`{${name}}`, replacement);
    });
    return value;
}

function resolveDefaultLanguage() {
    const uiLanguage = (chrome.i18n && chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : 'en').toLowerCase();
    return uiLanguage.startsWith('zh') ? 'zh' : 'en';
}

function mapSnapshotReason(reason) {
    const reasonMap = {
        manual: t('snapshotReasonManual'),
        initial: t('snapshotReasonInitial'),
        periodic: t('snapshotReasonPeriodic'),
        content_change: t('snapshotReasonContentChange'),
        visibility_hidden: t('snapshotReasonHidden'),
        beforeunload: t('snapshotReasonBeforeUnload'),
        auto_name: t('snapshotReasonAutoName')
    };
    return reasonMap[reason] || reason || t('snapshotReasonManual');
}

function getHttpsOriginPattern(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:') return null;
        return `${url.origin}/*`;
    } catch {
        return null;
    }
}

function storageGetAsync(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => {
            resolve(result || {});
        });
    });
}

function storageSetAsync(values) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(values, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

function permissionsContainsAsync(origins) {
    return new Promise((resolve, reject) => {
        chrome.permissions.contains({ origins: origins }, (granted) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(!!granted);
        });
    });
}

function permissionsRequestAsync(origins) {
    return new Promise((resolve, reject) => {
        chrome.permissions.request({ origins: origins }, (granted) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(!!granted);
        });
    });
}

function mapTrackErrorMessage(code, fallbackError) {
    switch (code) {
        case 'UNSUPPORTED_URL':
            return t('trackUnsupportedHttps');
        case 'HOST_PERMISSION_DENIED':
            return t('permissionDenied');
        case 'INJECTION_FAILED':
            return t('trackInjectionFailed');
        case 'PERMISSION_REQUEST_FAILED':
            return t('permissionRequestFailed', { error: fallbackError || t('unknownError') });
        default:
            return fallbackError || t('unknownError');
    }
}

async function ensureTrackPermissionForTab(tab) {
    const rawUrl = (tab && (tab.url || tab.pendingUrl)) || '';
    const originPattern = getHttpsOriginPattern(rawUrl);
    if (!originPattern) {
        return { ok: false, code: 'UNSUPPORTED_URL' };
    }

    const alreadyGranted = await permissionsContainsAsync([originPattern]);
    if (alreadyGranted) {
        return { ok: true, originPattern: originPattern };
    }

    const settings = await storageGetAsync(['permissionNoticeAcceptedV1']);
    if (!settings.permissionNoticeAcceptedV1) {
        const accepted = confirm(t('permissionNotice'));
        if (!accepted) {
            return { ok: false, code: 'HOST_PERMISSION_DENIED' };
        }
        await storageSetAsync({ permissionNoticeAcceptedV1: true });
    }

    try {
        const granted = await permissionsRequestAsync([originPattern]);
        if (!granted) {
            return { ok: false, code: 'HOST_PERMISSION_DENIED' };
        }
    } catch (e) {
        return {
            ok: false,
            code: 'PERMISSION_REQUEST_FAILED',
            error: e && e.message ? e.message : t('unknownError'),
        };
    }

    return { ok: true, originPattern: originPattern };
}

function applyI18n() {
    document.title = t('appTitle');

    const setText = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.textContent = t(key);
    };

    setText('app-title', 'appTitle');
    setText('label-track-tab', 'trackTab');
    setText('empty-title', 'emptyTitle');
    setText('empty-hint', 'emptyHint');
    if (!activeSnapshotNodeId) setText('snapshot-title', 'snapshotTitle');
    setText('snapshot-tab-html', 'snapshotVisual');
    setText('snapshot-tab-text', 'snapshotText');
    setText('settings-main-title', 'mainSettingsTitle');
    setText('menu-naming', 'menuNaming');
    setText('menu-appearance', 'menuAppearance');
    setText('menu-language', 'menuLanguage');
    setText('settings-naming-title', 'namingTitle');
    setText('naming-desc', 'namingDesc');
    setText('naming-type-label', 'namingTypeLabel');
    setText('setting-builtin-hint', 'builtinHint');
    setText('setting-local-hint', 'localHint');
    setText('btn-config-custom-text', 'configApi');
    setText('btn-save-naming', 'save');
    setText('settings-appearance-title', 'appearanceTitle');
    setText('settings-language-title', 'languageTitle');
    setText('theme-label', 'themeLabel');
    setText('language-label', 'languageLabel');
    setText('btn-save-appearance', 'save');
    setText('btn-save-language', 'save');
    setText('settings-custom-title', 'customTitle');
    setText('custom-api-hint', 'customHint');
    setText('model-label', 'modelLabel');
    setText('btn-test-connection', 'testConnection');
    setText('btn-save-custom-api', 'saveAndReturn');

    const updateTitle = (selector, key) => {
        document.querySelectorAll(selector).forEach((el) => {
            el.title = t(key);
        });
    };
    updateTitle('#btn-settings', 'settingsTitle');
    updateTitle('#btn-track', 'trackCurrentTabTitle');
    updateTitle('#btn-close-snapshot', 'close');
    updateTitle('#btn-close-settings', 'close');
    updateTitle('.btn-close-settings', 'close');
    updateTitle('.settings-back', 'backToSettings');
    updateTitle('.settings-back-to-naming', 'backToNaming');

    const namingOptionBuiltin = document.querySelector('#setting-naming-type option[value="builtin"]');
    const namingOptionCustom = document.querySelector('#setting-naming-type option[value="custom"]');
    const namingOptionLocal = document.querySelector('#setting-naming-type option[value="local"]');
    if (namingOptionBuiltin) namingOptionBuiltin.textContent = t('namingBuiltin');
    if (namingOptionCustom) namingOptionCustom.textContent = t('namingCustom');
    if (namingOptionLocal) namingOptionLocal.textContent = t('namingLocal');

    const themeSystem = document.querySelector('#setting-theme option[value="system"]');
    const themeLight = document.querySelector('#setting-theme option[value="light"]');
    const themeDark = document.querySelector('#setting-theme option[value="dark"]');
    if (themeSystem) themeSystem.textContent = t('themeSystem');
    if (themeLight) themeLight.textContent = t('themeLight');
    if (themeDark) themeDark.textContent = t('themeDark');
}

async function initializeLocalization() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['uiLanguage'], (result) => {
            const stored = result.uiLanguage;
            if (stored === 'en' || stored === 'zh') {
                currentLanguage = stored;
                applyI18n();
                resolve();
                return;
            }

            currentLanguage = resolveDefaultLanguage();
            chrome.storage.local.set({ uiLanguage: currentLanguage }, () => {
                applyI18n();
                resolve();
            });
        });
    });
}

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
        clearDragDropState();
        return;
    }

    emptyState.style.display = 'none';
    treeContainer.style.display = '';

    const roots = buildTreeHierarchy(treeNodes);
    treeContainer.innerHTML = '';
    treeContainer.classList.remove('root-drop-target');
    currentDropTargetNodeId = null;

    roots.forEach(root => {
        treeContainer.appendChild(createNodeElement(root));
    });
}

function collectDescendantIds(nodeId) {
    const descendants = new Set();
    const queue = [nodeId];
    while (queue.length > 0) {
        const current = queue.shift();
        treeNodes.forEach((node) => {
            if (node.parentId === current && !descendants.has(node.id)) {
                descendants.add(node.id);
                queue.push(node.id);
            }
        });
    }
    return descendants;
}

function canMoveNode(nodeId, newParentId) {
    if (!nodeId) return false;
    if (newParentId === nodeId) return false;
    if (!newParentId) return true;
    const descendants = collectDescendantIds(nodeId);
    return !descendants.has(newParentId);
}

function clearDropTargetHighlight() {
    treeContainer.querySelectorAll('.node-row.drop-target').forEach((row) => {
        row.classList.remove('drop-target');
    });
    treeContainer.classList.remove('root-drop-target');
    currentDropTargetNodeId = null;
}

function setNodeDropTarget(nodeId) {
    if (!nodeId || currentDropTargetNodeId === nodeId) return;
    clearDropTargetHighlight();
    const row = treeContainer.querySelector(`.node-row[data-node-id="${nodeId}"]`);
    if (!row) return;
    row.classList.add('drop-target');
    currentDropTargetNodeId = nodeId;
}

function setRootDropTarget() {
    if (treeContainer.classList.contains('root-drop-target')) return;
    clearDropTargetHighlight();
    treeContainer.classList.add('root-drop-target');
}

function clearDragDropState() {
    draggingNodeId = null;
    clearDropTargetHighlight();
    treeContainer.querySelectorAll('.node-row.dragging').forEach((row) => {
        row.classList.remove('dragging');
    });
}

function moveNode(nodeId, newParentId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'MOVE_NODE', nodeId: nodeId, newParentId: newParentId }, (response) => {
            if (chrome.runtime.lastError) {
                alert(`${t('runtimeErrorPrefix')}: ${chrome.runtime.lastError.message}`);
                resolve(false);
                return;
            }
            if (!response || !response.success) {
                alert(`${t('runtimeErrorPrefix')}: ${response ? response.error : t('unknownError')}`);
                resolve(false);
                return;
            }
            loadTree().then(() => resolve(true));
        });
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
    const displayTitle = node.title || t('untitled');
    const isNaming = node.namingStatus === 'pending';
    const timeAgo = getTimeAgo(node.createdAt);

    // Node row
    const row = document.createElement('div');
    row.className = 'node-row' + (node.status === 'live' && node.tabId === activeTabId ? ' active' : '');
    row.dataset.nodeId = node.id;
    row.draggable = true;

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
    status.title = node.status === 'live' ? t('statusLive') : t('statusClosed');

    // Label
    const label = document.createElement('span');
    label.className = 'node-label';
    const effectiveLabel = displayLabel || node.autoLabel || '';
    if (effectiveLabel) {
        label.innerHTML = `<span class="custom-label">${escapeHtml(truncate(effectiveLabel, 56))}</span>`;
    } else {
        label.innerHTML = `<span class="page-title">${escapeHtml(truncate(displayTitle, 50))}</span>`;
    }

    const namingStatus = document.createElement('span');
    namingStatus.className = 'node-naming-status';
    namingStatus.textContent = t('namingInProgress');
    namingStatus.style.display = isNaming ? '' : 'none';

    // Time
    const time = document.createElement('span');
    time.className = 'node-time';
    time.textContent = timeAgo;

    row.appendChild(toggle);
    row.appendChild(status);
    row.appendChild(label);
    row.appendChild(namingStatus);
    row.appendChild(time);

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

    row.addEventListener('dragstart', (e) => {
        draggingNodeId = node.id;
        currentDropTargetNodeId = null;
        row.classList.add('dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.id);
        }
    });

    row.addEventListener('dragend', () => {
        clearDragDropState();
    });

    row.addEventListener('dragover', (e) => {
        if (!draggingNodeId || draggingNodeId === node.id) return;
        if (!canMoveNode(draggingNodeId, node.id)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        setNodeDropTarget(node.id);
    });

    row.addEventListener('drop', async (e) => {
        if (!draggingNodeId) return;
        e.preventDefault();
        e.stopPropagation();
        const sourceId = draggingNodeId;
        clearDragDropState();
        if (!canMoveNode(sourceId, node.id)) return;
        await moveNode(sourceId, node.id);
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
            snapshotTitle.textContent = t('snapshotMissingTitle');
            snapshotMeta.textContent = '';
            snapshotContent.innerHTML = `<div class="text-view" style="color:var(--text-muted); text-align:center; padding-top:40px;">${escapeHtml(t('snapshotMissingBody'))}</div>`;
            snapshotViewer.style.display = '';
            return;
        }

        const snap = response.snapshot;
        snapshotTitle.textContent = snap.title || (node ? node.title : t('snapshotTitle'));
        snapshotMeta.textContent = `${t('snapshotCapturedAt', { time: formatTime(snap.capturedAt) })} · ${mapSnapshotReason(snap.reason)}`;

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
        cleanHtml = `<p style="color:#888; text-align:center; padding:40px;">${escapeHtml(t('emptyPage'))}</p>`;
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

    if (!text || !text.trim()) {
        const div = document.createElement('div');
        div.className = 'text-view';
        div.textContent = t('noTextContent');
        snapshotContent.appendChild(div);
        return;
    }

    // Format text into paragraphs: split by double newlines, preserve single newlines
    const paragraphs = text.split(/\n{2,}/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const bg = isDark ? '#1a1a24' : '#fafafa';
    const fg = isDark ? '#d8d8e8' : '#2a2a3e';
    const muted = isDark ? '#7a7a9a' : '#6a6a8a';
    const border = isDark ? '#2a2a3e' : '#e0e0e8';
    const codeBg = isDark ? '#22223a' : '#f0f0f5';

    const escapeHtmlStr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Build formatted HTML from text paragraphs
    const htmlParagraphs = paragraphs.map(p => {
        const lines = p.split('\n');
        // Detect code blocks (lines starting with spaces/tabs or common code patterns)
        const looksLikeCode = lines.length > 1 && lines.every(l =>
            l.startsWith('  ') || l.startsWith('\t') || l.match(/^[\s]*[{}\[\]();]/)
        );
        if (looksLikeCode) {
            return `<pre><code>${escapeHtmlStr(p)}</code></pre>`;
        }
        return `<p>${escapeHtmlStr(p).replace(/\n/g, '<br>')}</p>`;
    }).join('\n');

    const readerCSS = `
        *, *::before, *::after { box-sizing: border-box; }
        body {
            background: ${bg};
            color: ${fg};
            font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            font-size: 14px;
            line-height: 1.8;
            padding: 20px;
            margin: 0;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        p {
            margin: 0.6em 0;
        }
        pre {
            background: ${codeBg};
            border: 1px solid ${border};
            border-radius: 6px;
            padding: 14px 16px;
            overflow-x: auto;
            margin: 0.8em 0;
            line-height: 1.5;
        }
        code {
            font-family: 'Consolas', 'Monaco', 'Menlo', monospace;
            font-size: 13px;
        }
        ::selection {
            background: ${isDark ? '#3a3a6a' : '#b3d4fc'};
        }
    `;

    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${readerCSS}</style></head><body>${htmlParagraphs}</body></html>`;
    snapshotContent.appendChild(iframe);
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
        ? t('confirmDeleteWithChildren')
        : t('confirmDeleteKeepChildren');
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
        items.push({ label: `🔀 ${t('menuSwitchTab')}`, action: () => switchToTab(node.tabId) });
        items.push({
            label: `📋 ${t('menuDuplicateTab')}`, action: () => {
                chrome.tabs.duplicate(node.tabId);
            }
        });
    }

    items.push({ separator: true });
    items.push({ label: `📷 ${t('menuViewSnapshot')}`, action: () => viewSnapshot(node.id) });
    items.push({
        label: `🤖 ${t('menuAutoName')}`, action: () => {
            chrome.runtime.sendMessage({ type: 'AUTO_NAME_NODE', nodeId: node.id });
        }
    });
    items.push({ separator: true });
    items.push({ label: `🗑️ ${t('menuDeleteNode')}`, action: () => deleteNode(node.id, false) });
    items.push({ label: `⚠️ ${t('menuDeleteWithChildren')}`, action: () => deleteNode(node.id, true), danger: true });

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
        if (!tab || !tab.id) {
            alert(t('noActiveTab'));
            return;
        }

        let permissionResult;
        try {
            permissionResult = await ensureTrackPermissionForTab(tab);
        } catch (e) {
            alert(t('permissionRequestFailed', { error: e && e.message ? e.message : t('unknownError') }));
            return;
        }

        if (!permissionResult.ok) {
            alert(mapTrackErrorMessage(permissionResult.code, permissionResult.error));
            return;
        }

        chrome.runtime.sendMessage({ type: 'START_TRACKING_TAB', tabId: tab.id }, (response) => {
            if (chrome.runtime.lastError) {
                alert(`${t('runtimeErrorPrefix')}: ${chrome.runtime.lastError.message}`);
                return;
            }
            if (!response || !response.success) {
                const errorMessage = mapTrackErrorMessage(response ? response.code : '', response ? response.error : t('unknownError'));
                alert(`${t('runtimeErrorPrefix')}: ${errorMessage}`);
                return;
            }
            loadTree();
        });
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

    treeContainer.addEventListener('dragover', (e) => {
        if (!draggingNodeId) return;
        const targetEl = e.target instanceof Element ? e.target : null;
        // Node-level drop takes precedence; root target is for container background.
        if (targetEl && targetEl.closest('.node-row')) return;
        if (!canMoveNode(draggingNodeId, null)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        setRootDropTarget();
    });

    treeContainer.addEventListener('dragleave', (e) => {
        if (!draggingNodeId) return;
        const relatedTarget = e.relatedTarget;
        if (relatedTarget && treeContainer.contains(relatedTarget)) return;
        clearDropTargetHighlight();
    });

    treeContainer.addEventListener('drop', async (e) => {
        if (!draggingNodeId) return;
        const targetEl = e.target instanceof Element ? e.target : null;
        if (targetEl && targetEl.closest('.node-row')) return;
        e.preventDefault();
        const sourceId = draggingNodeId;
        clearDragDropState();
        if (!canMoveNode(sourceId, null)) return;
        await moveNode(sourceId, null);
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
    return new Date(timestamp).toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US');
}

// ── Settings ──

const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');

// Views
const settingsMain = document.getElementById('settings-main');
const settingsNaming = document.getElementById('settings-naming');
const settingsAppearance = document.getElementById('settings-appearance');
const settingsLanguage = document.getElementById('settings-language');
const settingsCustomApi = document.getElementById('settings-custom-api');

// Form elements
const settingNamingType = document.getElementById('setting-naming-type');
const settingApiUrl = document.getElementById('setting-api-url');
const settingApiKey = document.getElementById('setting-api-key');
const settingModel = document.getElementById('setting-model');
const settingTheme = document.getElementById('setting-theme');
const settingLanguage = document.getElementById('setting-language');

// Buttons
const btnSaveNaming = document.getElementById('btn-save-naming');
const btnSaveAppearance = document.getElementById('btn-save-appearance');
const btnSaveLanguage = document.getElementById('btn-save-language');
const btnTestConnection = document.getElementById('btn-test-connection');
const btnConfigCustom = document.getElementById('btn-config-custom');
const btnSaveCustomApi = document.getElementById('btn-save-custom-api');

// ── Settings Navigation ──

function showSettingsView(viewId) {
    // Hide all views
    settingsMain.style.display = 'none';
    settingsNaming.style.display = 'none';
    settingsAppearance.style.display = 'none';
    if (settingsLanguage) settingsLanguage.style.display = 'none';
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
    chrome.storage.local.get(['aiNamingType', 'aiApiUrl', 'aiApiKey', 'aiModel', 'theme', 'uiLanguage'], (result) => {
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
        if (settingLanguage) {
            settingLanguage.value = (result.uiLanguage === 'zh' || result.uiLanguage === 'en') ? result.uiLanguage : currentLanguage;
            currentLanguage = settingLanguage.value;
        }
        applyI18n();
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

function saveLanguageSettings() {
    const language = (settingLanguage && settingLanguage.value === 'zh') ? 'zh' : 'en';
    chrome.storage.local.set({ uiLanguage: language }, () => {
        currentLanguage = language;
        applyI18n();
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
    btnTestConnection.innerText = t('testing');
    btnTestConnection.disabled = true;

    const namingType = settingNamingType.value;
    let apiKey, baseUrl, model;

    if (namingType === 'custom') {
        apiKey = settingApiKey.value.trim();
        baseUrl = (settingApiUrl.value.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
        model = settingModel.value.trim();

        if (!apiKey) {
            alert(t('enterApiKeyFirst'));
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
            alert(`${t('runtimeErrorPrefix')}: ${chrome.runtime.lastError.message}`);
            resetButton();
            return;
        }

        if (response && response.success) {
            btnTestConnection.innerText = t('testSuccess');
            btnTestConnection.style.background = 'var(--green)';
            btnTestConnection.style.color = '#fff';
            setTimeout(resetButton, 2000);
        } else {
            alert(t('connectionFailed', { error: response ? response.error : t('unknownError') }));
            btnTestConnection.innerText = t('testFailed');
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
    if (btnSaveLanguage) btnSaveLanguage.addEventListener('click', saveLanguageSettings);
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
    if (settingLanguage) {
        settingLanguage.addEventListener('change', () => {
            currentLanguage = (settingLanguage.value === 'zh') ? 'zh' : 'en';
            applyI18n();
        });
    }

    // Click backdrop to close
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettings();
    });
}

// ── Start ──
// Initialize theme + language
chrome.storage.local.get(['theme'], async (result) => {
    applyTheme(result.theme || 'system');
    await initializeLocalization();
    init();
});
