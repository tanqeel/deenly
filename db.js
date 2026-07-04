/* Tiny IndexedDB wrapper. Everything lives on-device; nothing ever
   leaves the phone/browser, and nothing is ever auto-deleted, so
   past months of finance, ideas, and notes stay searchable forever. */

const DB_NAME = "deen-discipline";
const DB_VERSION = 1;
const STORES = [
  "transactions",   // personal income/expense
  "members",        // hostel / friend group members
  "groupExpenses",  // MemoGo-style shared expenses
  "notes",          // Keep-style notes
  "ideas",          // idea board
  "habits",         // habit definitions
  "dayLogs",        // per-date: prayers, habit checks, health, journal, study (keyPath = date string)
  "goals",
  "settings",       // singleton rows: 'prayer', 'routine'
];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbReady = openDB();

async function tx(store, mode) {
  const db = await dbReady;
  return db.transaction(store, mode).objectStore(store);
}

const DB = {
  async put(store, obj) {
    const s = await tx(store, "readwrite");
    return new Promise((res, rej) => {
      const r = s.put(obj);
      r.onsuccess = () => res(obj);
      r.onerror = () => rej(r.error);
    });
  },
  async get(store, id) {
    const s = await tx(store, "readonly");
    return new Promise((res, rej) => {
      const r = s.get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  },
  async all(store) {
    const s = await tx(store, "readonly");
    return new Promise((res, rej) => {
      const r = s.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  async delete(store, id) {
    const s = await tx(store, "readwrite");
    return new Promise((res, rej) => {
      const r = s.delete(id);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    });
  },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayStr = (d = new Date()) => {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
};

window.DB = DB;
