/**
 * storage.js — IndexedDB wrapper for AI Conversation Tree
 * 
 * Two object stores:
 *   - nodes: tree node metadata
 *   - snapshots: captured page content
 */

const DB_NAME = 'ai-conversation-tree';
const DB_VERSION = 1;

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('nodes')) {
        const nodeStore = db.createObjectStore('nodes', { keyPath: 'id' });
        nodeStore.createIndex('parentId', 'parentId', { unique: false });
        nodeStore.createIndex('tabId', 'tabId', { unique: false });
      }

      if (!db.objectStoreNames.contains('snapshots')) {
        const snapStore = db.createObjectStore('snapshots', { keyPath: 'nodeId' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      // Reset cached instance if DB connection is unexpectedly closed
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

// ── Node operations ──

async function saveNode(node) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('nodes', 'readwrite');
    tx.objectStore('nodes').put(node);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getNode(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('nodes', 'readonly');
    const req = tx.objectStore('nodes').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getAllNodes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('nodes', 'readonly');
    const req = tx.objectStore('nodes').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getNodeByTabId(tabId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('nodes', 'readonly');
    const index = tx.objectStore('nodes').index('tabId');
    const req = index.getAll(tabId);
    req.onsuccess = () => resolve(req.result?.[0] || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function deleteNode(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('nodes', 'readwrite');
    tx.objectStore('nodes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ── Snapshot operations ──

async function saveSnapshot(snapshot) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(snapshot);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getSnapshot(nodeId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const req = tx.objectStore('snapshots').get(nodeId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function deleteSnapshot(nodeId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').delete(nodeId);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Export for use as module or via globalThis
if (typeof globalThis !== 'undefined') {
  globalThis.TreeStorage = {
    openDB,
    saveNode,
    getNode,
    getAllNodes,
    getNodeByTabId,
    deleteNode,
    saveSnapshot,
    getSnapshot,
    deleteSnapshot,
  };
}
