import Database from "better-sqlite3";

/**
 * Thin access to the SQLite file written by the server (schema in apps/server-rs/src/database.rs):
 *   users(id, ext_id, name, created_at), sessions(user_id, token, sync, created_at, updated_at),
 *   save_documents(user_id, tag, json, updated_at), meta(key, value, updated_at).
 * Documents are JSON.stringify'd objects, user 1 is the only player.
 */
export class SaveDb {
  readonly db: Database.Database;

  constructor(path: string, readonly readOnly: boolean, readonly userId = 1) {
    this.db = new Database(path, readOnly ? { readonly: true, fileMustExist: true } : { fileMustExist: true });
    if (!readOnly) this.db.pragma("busy_timeout = 5000");
  }

  close(): void {
    this.db.close();
  }

  doc<T = any>(tag: string, userId = this.userId): T | undefined {
    const row = this.db.prepare("SELECT json FROM save_documents WHERE user_id = ? AND tag = ?").get(userId, tag) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  setDoc(tag: string, document: unknown, userId = this.userId): void {
    this.db
      .prepare("INSERT OR REPLACE INTO save_documents (user_id, tag, json, updated_at) VALUES (?, ?, ?, ?)")
      .run(userId, tag, JSON.stringify(document), new Date().toISOString());
  }

  /** Read-modify-write one document; `fn` may mutate in place or return a replacement. */
  editDoc<T = any>(tag: string, fn: (doc: T) => T | void): void {
    const doc = this.doc<T>(tag);
    if (!doc) throw new Error(`document ${tag} missing`);
    const out = fn(doc);
    this.setDoc(tag, out === undefined ? doc : out);
  }

  /** Edit the universe document with convenient handles (profile, mine/rival company, world container). */
  editUniverse(fn: (u: UniverseCtx) => void): void {
    this.editDoc("universe", (universe: any) => {
      fn(universeCtx(universe));
    });
  }

  meta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES (?, ?, ?)").run(key, value, new Date().toISOString());
  }

  deleteMeta(key: string): void {
    this.db.prepare("DELETE FROM meta WHERE key = ?").run(key);
  }

  session(): { user_id: number; token: string; sync: number } | undefined {
    return this.db.prepare("SELECT user_id, token, sync FROM sessions WHERE user_id = ?").get(this.userId) as any;
  }

  user(id = this.userId): { id: number; ext_id: string; name: string } | undefined {
    return this.db.prepare("SELECT id, ext_id, name FROM users WHERE id = ?").get(id) as any;
  }

  insertUser(id: number, extId: string, name: string): void {
    this.db.prepare("INSERT INTO users (id, ext_id, name, created_at) VALUES (?, ?, ?, ?)").run(id, extId, name, new Date().toISOString());
  }
}

export interface UniverseCtx {
  universe: any;
  /** The Profile container (the object that has a `Profile` array: it also holds DCCoins, exp, tutorialEnd, ...). */
  profile: any;
  worldContainer: any;
  /** The player's company (whose = "0"): `.Company` is its item list. */
  mine: any;
  /** The rival company (whose = "1"). */
  rival: any;
}

export function universeCtx(universe: any): UniverseCtx {
  const root = universe.universe as any[];
  const profile = root.find((e) => Array.isArray(e?.Profile));
  const worldContainer = root.find((e) => Array.isArray(e?.World));
  const companies = (worldContainer?.World ?? []).filter((e: any) => Array.isArray(e?.Company));
  return {
    universe,
    profile,
    worldContainer,
    mine: companies.find((c: any) => c.whose === "0"),
    rival: companies.find((c: any) => c.whose === "1")
  };
}

/** The State entry of an item (`Item: [{ State: [], id, mode, time, ... }]`). */
export function stateOf(item: any): any {
  return item?.Item?.find((e: any) => Array.isArray(e.State));
}

/** Find an item of the player's company by sid, in a universe as stored in the DB or as returned by get_world. */
export function findMineItem(universe: any, sid: string): any {
  return universeCtx(universe).mine?.Company.find((i: any) => i.sid === sid);
}
