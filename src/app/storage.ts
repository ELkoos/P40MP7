/** Tekst zapisany lokalnie (sekcja 7, magazyn `scripts`). */
export interface Script {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  /** Ostatnia pozycja czytania jako numer słowa źródłowego (F-04). */
  lastWord: number;
}

const DB_NAME = "prompter";
const STORE = "scripts";

export interface ScriptStore {
  /** false, gdy IndexedDB jest niedostępne i dane giną po zamknięciu karty. */
  readonly persistent: boolean;
  list(): Promise<Script[]>;
  get(id: string): Promise<Script | undefined>;
  put(s: Script): Promise<void>;
  remove(id: string): Promise<void>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class IdbStore implements ScriptStore {
  readonly persistent = true;
  constructor(private db: IDBDatabase) {}
  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }
  async list(): Promise<Script[]> {
    const all = await request(this.store("readonly").getAll() as IDBRequest<Script[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  get(id: string): Promise<Script | undefined> {
    return request(this.store("readonly").get(id) as IDBRequest<Script | undefined>);
  }
  async put(s: Script): Promise<void> {
    await request(this.store("readwrite").put(s));
  }
  async remove(id: string): Promise<void> {
    await request(this.store("readwrite").delete(id));
  }
}

class MemoryStore implements ScriptStore {
  readonly persistent = false;
  private items = new Map<string, Script>();
  async list(): Promise<Script[]> {
    return [...this.items.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async get(id: string): Promise<Script | undefined> {
    return this.items.get(id);
  }
  async put(s: Script): Promise<void> {
    this.items.set(s.id, { ...s });
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export async function openStore(): Promise<ScriptStore> {
  try {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    return new IdbStore(await request(req));
  } catch {
    return new MemoryStore();
  }
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Domyślny tytuł: pierwsze słowa tekstu. */
export function titleFrom(body: string): string {
  const words = body.trim().split(/\s+/).slice(0, 6).join(" ");
  return words.length > 0 ? words : "Bez tytułu";
}
