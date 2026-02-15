/**
 * content.js — Universal page content capture
 * 
 * Injected into all pages. Responsibilities:
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

    return {
        html: document.body ? document.body.innerHTML : '',
        styles: styles,
        text: document.body ? document.body.innerText : '',
        title: document.title,
        url: location.href,
        capturedAt: Date.now(),
    };
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
