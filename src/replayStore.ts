import type { ReplayRecord } from './replay';

/** Replays kept in this browser (oldest dropped beyond this). */
const KEEP = 50;
const DB = 'blockmarshal';
const STORE = 'replays';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('endedAt', 'endedAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Keep a finished game in this browser. Storage can be unavailable (private mode): then nothing is kept. */
export async function saveReplay(r: ReplayRecord): Promise<void> {
  try {
    const db = await open();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    await done(store.put(r));
    const all = await done(store.index('endedAt').getAllKeys());
    for (const key of all.slice(0, Math.max(0, all.length - KEEP))) store.delete(key);
  } catch {
    /* replays are a bonus */
  }
}

/** Newest first. */
export async function listReplays(): Promise<ReplayRecord[]> {
  try {
    const db = await open();
    const all = await done(db.transaction(STORE).objectStore(STORE).getAll());
    return (all as ReplayRecord[]).sort((a, b) => b.endedAt - a.endedAt);
  } catch {
    return [];
  }
}

export async function getReplay(id: string): Promise<ReplayRecord | undefined> {
  try {
    const db = await open();
    return (await done(db.transaction(STORE).objectStore(STORE).get(id))) as ReplayRecord | undefined;
  } catch {
    return undefined;
  }
}
