// Thin IndexedDB wrapper. All personal data lives here, on the device.
// Bump DB_VERSION and add a step to `upgrade` when stores change.

const DB_NAME = 'time-garden';
const DB_VERSION = 4;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('startedAt', 'startedAt');
    const events = db.createObjectStore('events', { keyPath: 'id' });
    events.createIndex('startedAt', 'startedAt');
    events.createIndex('sessionId', 'sessionId');
    db.createObjectStore('pages', { keyPath: 'date' });
    db.createObjectStore('kv', { keyPath: 'key' });
  }
  if (oldVersion < 2) {
    // Planner
    db.createObjectStore('projects', { keyPath: 'id' });
    const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
    tasks.createIndex('projectId', 'projectId');
    db.createObjectStore('routines', { keyPath: 'id' });
    db.createObjectStore('routineLog', { keyPath: 'id' });
  }
  if (oldVersion < 3) {
    // User-made images: stickers, washi textures, project folder covers.
    db.createObjectStore('assets', { keyPath: 'id' });
  }
  if (oldVersion < 4) {
    // Studio: idea post-its, inspiration videos, tutorials.
    db.createObjectStore('cards', { keyPath: 'id' });
  }
}

export const DATA_STORES = ['sessions', 'events', 'pages', 'projects', 'tasks', 'routines', 'routineLog', 'assets', 'cards'];

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB yok'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Veritabanı başka bir sekmede açık'));
  });
  return dbPromise;
}

function tx(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('İşlem iptal edildi'));
    result = fn(t);
  }));
}

export function getAll(store) {
  return open().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export function put(store, value) {
  return tx([store], 'readwrite', (t) => { t.objectStore(store).put(value); });
}

export function del(store, key) {
  return tx([store], 'readwrite', (t) => { t.objectStore(store).delete(key); });
}

/** Apply several writes atomically: [{store, put}] or [{store, del}] */
export function batch(ops) {
  const stores = [...new Set(ops.map((o) => o.store))];
  if (!stores.length) return Promise.resolve();
  return tx(stores, 'readwrite', (t) => {
    for (const o of ops) {
      if ('put' in o) t.objectStore(o.store).put(o.put);
      else t.objectStore(o.store).delete(o.del);
    }
  });
}

/** Replace the whole dataset in one transaction (used by restore). */
export function replaceAll(data) {
  return tx([...DATA_STORES, 'kv'], 'readwrite', (t) => {
    for (const name of DATA_STORES) {
      const s = t.objectStore(name);
      s.clear();
      for (const r of data[name] || []) s.put(r);
    }
    t.objectStore('kv').put({ key: 'settings', value: data.settings || {} });
  });
}
