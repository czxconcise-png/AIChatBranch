/**
 * content.js — Universal page content capture
 * 
 * Injected on-demand into granted HTTPS pages. Responsibilities:
 * 1. Respond to CAPTURE_SNAPSHOT messages from background
 * 2. Periodic auto-snapshot every 30 seconds (if tab is tracked)
 * 3. Attempt snapshot on beforeunload
 * 4. Attempt snapshot on visibility change (tab switch)
 */

let isTracked = false;
let snapshotInterval = null;

/**
 * Check if extension context is still valid.
 * After extension reload, old content scripts become orphaned
 * and chrome.runtime.id becomes undefined.
 */
function isContextValid() {
    try {
        return !!(chrome.runtime && chrome.runtime.id);
    } catch {
        return false;
    }
}

/**
 * Capture the current page content including inline styles
 */
function capturePageContent() {
    // Collect inline <style> tags from <head> for snapshot rendering
    let styles = '';
    try {
        const styleTags = document.querySelectorAll('head style');
        styleTags.forEach(s => { styles += s.outerHTML; });
    } catch (e) { /* ignore */ }

    // Find the best content root — try conversation-specific selectors first
    // These target the main chat area on popular AI sites, skipping sidebars
    const conversationSelectors = [
        '[role="main"]',           // Gemini, some others
        'main',                    // ChatGPT, Claude, general
    ];

    let contentRoot = null;
    for (const sel of conversationSelectors) {
        contentRoot = document.querySelector(sel);
        if (contentRoot) break;
    }
    if (!contentRoot) contentRoot = document.body;

    // Clone and strip sidebar/nav elements to keep only conversation content
    const clone = contentRoot.cloneNode(true);
    const stripSelectors = [
        'nav', 'aside', 'header', 'footer',
        'side-navigation', 'side-nav',                     // Gemini custom elements
        '[role="navigation"]', '[role="complementary"]',    // ARIA roles for sidebars
        '[role="banner"]', '[role="contentinfo"]',          // ARIA header/footer
    ];
    stripSelectors.forEach(sel => {
        clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    return {
        html: clone.innerHTML,
        styles: styles,
        text: clone.innerText,
        title: document.title,
        url: location.href,
        capturedAt: Date.now(),
    };
}

function isProbablyUserPrompt(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 320) return false;
    if (/^[Qq][:\s]/.test(trimmed)) return true;
    if (/^(You|User|我|用户)[:：\s]/i.test(trimmed)) return true;
    if (/[?？]$/.test(trimmed)) return true;
    if (/^(请|帮我|怎么|如何|为什么|what|how|why|can you|please)\b/i.test(trimmed)) return true;
    return false;
}

function isVisibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isScrollableElement(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if (!(overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')) return false;
    return el.scrollHeight > el.clientHeight + 12;
}

function getScrollableAncestors(el) {
    const ancestors = [];
    let current = el ? el.parentElement : null;
    while (current) {
        if (isScrollableElement(current)) {
            ancestors.push(current);
        }
        current = current.parentElement;
    }
    return ancestors;
}

function getConversationRoot() {
    return document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
}

function getPrimaryConversationScroller() {
    const root = getConversationRoot();
    const candidates = [root, ...getScrollableAncestors(root)];
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
        if (!el || !isScrollableElement(el)) continue;
        const score = (el.scrollHeight - el.clientHeight) * Math.max(el.clientWidth, 1);
        if (score > bestScore) {
            best = el;
            bestScore = score;
        }
    }
    return best;
}

function scrollContainerToTarget(container, target, offset = 84) {
    if (!container || !target) return false;
    const targetRect = target.getBoundingClientRect();

    if (container === window || container === document || container === document.body || container === document.documentElement || container === document.scrollingElement) {
        const y = Math.max(0, window.scrollY + targetRect.top - offset);
        window.scrollTo({ top: y, behavior: 'auto' });
        return true;
    }

    const containerRect = container.getBoundingClientRect();
    const desiredTop = container.scrollTop + (targetRect.top - containerRect.top) - 24;
    container.scrollTop = Math.max(0, desiredTop);
    return true;
}

function findLatestTurnStartAnchor() {
    const userSelectors = [
        '[data-message-author-role="user"]',
        '[data-testid*="user"]',
        '[data-role="user"]',
        '[data-author="user"]',
        '[data-sender="user"]',
        '.user-message',
    ];

    for (const selector of userSelectors) {
        const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisibleElement);
        if (nodes.length > 0) {
            return nodes[nodes.length - 1];
        }
    }

    const assistantSelectors = [
        '[data-message-author-role="assistant"]',
        '[data-testid="assistant-response"]',
        '[data-testid*="assistant"]',
        '[data-role="assistant"]',
        '[data-author="assistant"]',
        '[data-sender="assistant"]',
        '.model-response',
        '.assistant-message',
        '.assistant',
    ];

    for (const selector of assistantSelectors) {
        const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisibleElement);
        if (nodes.length > 0) {
            return nodes[nodes.length - 1];
        }
    }

    const genericMessageSelectors = [
        'main article',
        '[role="main"] article',
        '[role="main"] [role="article"]',
        '[role="main"] .message',
        '[role="main"] .response',
    ];

    for (const selector of genericMessageSelectors) {
        const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisibleElement);
        if (nodes.length > 0) {
            // Prefer latest user-like message as the beginning of the latest round.
            for (let i = nodes.length - 1; i >= 0; i -= 1) {
                const text = (nodes[i].textContent || '').trim();
                if (text.length >= 4 && isProbablyUserPrompt(text)) {
                    return nodes[i];
                }
            }
            // Fallback to assistant-like content near the end.
            for (let i = nodes.length - 1; i >= 0; i -= 1) {
                const text = (nodes[i].textContent || '').trim();
                if (text.length >= 16 && !isProbablyUserPrompt(text)) {
                    return nodes[i];
                }
            }
            return nodes[nodes.length - 1];
        }
    }

    return document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
}

function scrollToLatestTurnStart() {
    const target = findLatestTurnStartAnchor();
    if (!target) return false;
    const offset = 84;

    // Ensure lazy-loaded/virtualized latest items are materialized.
    const primaryScroller = getPrimaryConversationScroller();
    if (primaryScroller && isScrollableElement(primaryScroller)) {
        primaryScroller.scrollTop = primaryScroller.scrollHeight;
    } else {
        const scrollingEl = document.scrollingElement || document.documentElement || document.body;
        scrollingEl.scrollTop = scrollingEl.scrollHeight;
    }

    target.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
    if (primaryScroller) {
        scrollContainerToTarget(primaryScroller, target, offset);
    }
    scrollContainerToTarget(document.scrollingElement || document.documentElement || document.body, target, offset);
    return true;
}

function scheduleLatestTurnScrollAttempts() {
    const delays = [0, 250, 800, 1600];
    delays.forEach((delay) => {
        setTimeout(() => { scrollToLatestTurnStart(); }, delay);
    });
}

/**
 * Buffer of recently added text from DOM mutations.
 * Collected by MutationObserver, sent with snapshot, then cleared.
 */
let recentlyAddedTexts = [];

/**
 * Send snapshot to background service worker
 */
function sendSnapshot(reason) {
    if (!isContextValid()) {
        stopPeriodicCapture();
        isTracked = false;
        return;
    }
    try {
        const content = capturePageContent();
        // Attach recently added text for auto-naming (only last 60 seconds)
        const now = Date.now();
        const recentTexts = recentlyAddedTexts
            .filter(item => (now - item.time) < 60000)
            .map(item => item.text);

        content.recentlyAdded = recentTexts.join('\n');
        recentlyAddedTexts = []; // clear buffer after sending

        chrome.runtime.sendMessage({
            type: 'SNAPSHOT_DATA',
            reason: reason,
            data: content,
        }).catch(() => { });
    } catch (e) {
        // Shouldn't happen after isContextValid check
    }
}

/**
 * Start periodic snapshots (every 30 seconds) + DOM change detection
 */
let mutationObserver = null;
let mutationDebounceTimer = null;

function startPeriodicCapture() {
    if (snapshotInterval) return;

    // 1) Periodic fallback: snapshot every 30s
    snapshotInterval = setInterval(() => {
        sendSnapshot('periodic');
    }, 30000);

    // 2) DOM change detection: snapshot when page content changes significantly
    //    (e.g., AI response appears, new chat message is added)
    if (!mutationObserver && document.body) {
        mutationObserver = new MutationObserver((mutations) => {
            let addedTextLength = 0;
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    const text = node.textContent ? node.textContent.trim() : '';
                    if (text.length > 0) {
                        addedTextLength += text.length;
                        // Buffer the added text for auto-naming (with timestamp)
                        recentlyAddedTexts.push({ text: text, time: Date.now() });
                    }
                }
            }
            // Threshold: at least 50 chars of new content
            if (addedTextLength < 50) return;

            // Debounce: wait 3s for AI to finish, then snapshot
            if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
            mutationDebounceTimer = setTimeout(() => {
                sendSnapshot('content_change');
            }, 3000);
        });

        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
}

/**
 * Stop periodic snapshots
 */
function stopPeriodicCapture() {
    if (snapshotInterval) {
        clearInterval(snapshotInterval);
        snapshotInterval = null;
    }
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
    if (mutationDebounceTimer) {
        clearTimeout(mutationDebounceTimer);
        mutationDebounceTimer = null;
    }
}

// ── Message listener ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isContextValid()) return;

    try {
        if (message.type === 'CAPTURE_SNAPSHOT') {
            const content = capturePageContent();
            sendResponse({ success: true, data: content });
            return false;
        }

        if (message.type === 'START_TRACKING') {
            isTracked = true;
            startPeriodicCapture();
            sendSnapshot('initial');
            sendResponse({ success: true });
            return false;
        }

        if (message.type === 'GET_CONTENT') {
            const content = capturePageContent();
            sendResponse(content);
            return false;
        }

        if (message.type === 'STOP_TRACKING') {
            isTracked = false;
            stopPeriodicCapture();
            sendResponse({ success: true });
            return false;
        }

        if (message.type === 'PING') {
            sendResponse({ success: true, isTracked: isTracked });
            return false;
        }

        if (message.type === 'SCROLL_TO_LATEST_TURN') {
            const first = scrollToLatestTurnStart();
            scheduleLatestTurnScrollAttempts();

            // Some sites restore their own scroll after focus; run once more when visible.
            const onVisible = () => {
                if (document.visibilityState === 'visible') {
                    scheduleLatestTurnScrollAttempts();
                }
                document.removeEventListener('visibilitychange', onVisible);
            };
            document.addEventListener('visibilitychange', onVisible);

            sendResponse({ success: first });
            return false;
        }
    } catch (e) {
        // Extension context invalidated
    }
});

// ── Visibility change: snapshot when user switches away ──

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isTracked) {
        sendSnapshot('visibility_hidden');
    }
});

// ── Before unload: last-chance snapshot ──

window.addEventListener('beforeunload', () => {
    if (isTracked && isContextValid()) {
        try {
            const content = capturePageContent();
            chrome.runtime.sendMessage({
                type: 'SNAPSHOT_DATA',
                reason: 'beforeunload',
                data: content,
            });
        } catch (e) {
            // Context invalid
        }
    }
});
