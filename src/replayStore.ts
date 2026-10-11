import { summarize, type ReplayRecord, type ReplaySummary } from './replay';

/** Replays kept in this browser (oldest dropped beyond this). */
const KEEP = 50;
const DB = 'blockmarshal';
const STORE = 'replays';
/** One small row per replay: the list reads only these, never the full records. */
const SUMMARIES = 'summaries';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('endedAt', 'endedAt');
      if (e.oldVersion < 2) {
        const summaries = db.createObjectStore(SUMMARIES, { keyPath: 'id' });
        summaries.createIndex('endedAt', 'endedAt');
        // Replays kept before summaries existed: summarise them once, here.
        const cursor = req.transaction!.objectStore(STORE).openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          summaries.put(summarize(c.value as ReplayRecord));
          c.continue();
        };
      }
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
    const tx = db.transaction([STORE, SUMMARIES], 'readwrite');
    const store = tx.objectStore(STORE);
    const summaries = tx.objectStore(SUMMARIES);
    await done(store.put(r));
    await done(summaries.put(summarize(r)));
    const all = await done(summaries.index('endedAt').getAllKeys());
    for (const key of all.slice(0, Math.max(0, all.length - KEEP))) {
      store.delete(key);
      summaries.delete(key);
    }
  } catch {
    /* replays are a bonus */
  }
}

/** Newest first: summaries only (a full record is loaded by getReplay when opened). */
export async function listReplays(): Promise<ReplaySummary[]> {
  try {
    const db = await open();
    const all = (await done(db.transaction(SUMMARIES).objectStore(SUMMARIES).getAll())) as ReplaySummary[];
    return all.sort((a, b) => b.endedAt - a.endedAt);
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
