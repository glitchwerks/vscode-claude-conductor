import * as vscode from "vscode";
import { isWorktreePath } from "./projectGrouping";
import { canonicalKey } from "./pathCanonical";

export interface FavoritesEntry {
  path: string;
}

export type FavoritesChangeEvent =
  | { kind: "single"; path: string }
  | { kind: "broad" };

interface FavoritesStorageEnvelope {
  version: 2;
  entries: FavoritesEntry[];
}

export const STORAGE_KEY = "claudeConductor.favorites";
export const MAX_FAVORITES = 25;

export interface MutationResult {
  ok: boolean;
  reason?: string;
}

function isFavoritesEntry(value: unknown): value is FavoritesEntry {
  return typeof value === "object"
    && value !== null
    && typeof (value as { path?: unknown }).path === "string";
}

/** Pure read; no write side effects. v1 string[] is converted in-memory only. */
function readWithoutMigrating(memento: vscode.Memento): {
  entries: FavoritesEntry[];
  unknownVersion: boolean;
} {
  const raw = memento.get<unknown>(STORAGE_KEY);
  if (raw === undefined || raw === null) return { entries: [], unknownVersion: false };
  if (Array.isArray(raw)) {
    if (raw.length === 0) return { entries: [], unknownVersion: false };
    if (typeof raw[0] === "string") {
      return {
        entries: raw.filter((p): p is string => typeof p === "string")
          .map(p => ({ path: p })),
        unknownVersion: false,
      };
    }
    return { entries: raw.filter(isFavoritesEntry), unknownVersion: false };
  }
  if (typeof raw === "object" && raw !== null && "version" in raw) {
    const env = raw as FavoritesStorageEnvelope;
    if (env.version === 2) {
      return {
        entries: Array.isArray(env.entries) ? env.entries.filter(isFavoritesEntry) : [],
        unknownVersion: false,
      };
    }
    const maybeEntries = (env as { entries?: unknown }).entries;
    return {
      entries: Array.isArray(maybeEntries) ? maybeEntries.filter(isFavoritesEntry) : [],
      unknownVersion: true,
    };
  }
  return { entries: [], unknownVersion: false };
}

export class FavoritesStore {
  private entries: FavoritesEntry[] = [];
  private keyIndex: Set<string> = new Set();
  private readonly _onDidChange = new vscode.EventEmitter<FavoritesChangeEvent>();
  readonly onDidChange = this._onDidChange.event;

  /** Tracks the latest persist (success or rollback). Mutations await this. */
  private persistChain: Promise<void> = Promise.resolve();

  /** True when storage envelope has an unknown future version — block writes. */
  private readonly unknownVersion: boolean;

  constructor(private readonly memento: vscode.Memento) {
    const r = readWithoutMigrating(memento);
    this.entries = r.entries;
    this.unknownVersion = r.unknownVersion;
    this.rebuildIndex();
    if (this.unknownVersion) {
      void vscode.window.showWarningMessage(
        "Favorites storage uses an unsupported newer version. This build will not modify it."
      );
    }
  }

  isFavorited(p: string): boolean {
    return this.keyIndex.has(canonicalKey(p));
  }
  list(): readonly FavoritesEntry[] { return this.entries; }
  isOverCap(): boolean { return this.entries.length > MAX_FAVORITES; }

  /** Test helper: wait for in-flight persists (and any rollback) to complete. */
  async waitForIdle(): Promise<void> {
    await this.persistChain.catch(() => undefined);
  }

  async add(p: string): Promise<MutationResult> {
    if (this.unknownVersion) {
      return { ok: false, reason: "Storage version is newer than this build supports." };
    }
    if (isWorktreePath(p)) {
      return { ok: false, reason: "Favorite the project root, not a worktree." };
    }
    let result: MutationResult = { ok: true };
    const key = canonicalKey(p);
    await this.enqueueMutation(
      snapshot => {
        if (snapshot.some(e => canonicalKey(e.path) === key)) {
          result = { ok: true };
          return snapshot;
        }
        if (snapshot.length >= MAX_FAVORITES) {
          result = {
            ok: false,
            reason: `Favorites cap reached (${MAX_FAVORITES}). Remove an entry first.`,
          };
          return snapshot;
        }
        result = { ok: true };
        return [...snapshot, { path: p }];
      },
      { kind: "single", path: p }
    );
    return result;
  }

  async remove(p: string): Promise<void> {
    if (this.unknownVersion) return;
    if (!this.isFavorited(p)) return;

    const key = canonicalKey(p);
    await this.enqueueMutation(
      snapshot => snapshot.filter(e => canonicalKey(e.path) !== key),
      { kind: "single", path: p }
    );
  }

  async relocate(oldPath: string, newPath: string): Promise<MutationResult> {
    if (this.unknownVersion) {
      return { ok: false, reason: "Storage version is newer than this build supports." };
    }
    if (isWorktreePath(newPath)) {
      return { ok: false, reason: "Favorite the project root, not a worktree." };
    }

    const oldKey = canonicalKey(oldPath);
    const newKey = canonicalKey(newPath);

    if (oldKey === newKey) {
      return { ok: false, reason: "That's the same path. Choose a different folder." };
    }

    let result: MutationResult = { ok: false, reason: "Original entry not found." };
    let payload: FavoritesChangeEvent = { kind: "single", path: newPath };
    await this.enqueueMutation(
      snapshot => {
        if (!snapshot.some(e => canonicalKey(e.path) === oldKey)) {
          result = { ok: false, reason: "Original entry not found." };
          payload = { kind: "broad" };
          return snapshot;
        }
        if (snapshot.some(e => canonicalKey(e.path) === newKey)) {
          result = {
            ok: true,
            reason: "That folder is already in your Favorites — removed the missing entry.",
          };
          payload = { kind: "broad" };
          return snapshot.filter(e => canonicalKey(e.path) !== oldKey);
        }
        result = { ok: true };
        payload = { kind: "single", path: newPath };
        return snapshot.map(e =>
          canonicalKey(e.path) === oldKey ? { path: newPath } : e
        );
      },
      () => payload
    );
    return result;
  }

  /** Test seam: expose enqueueMutation for the apply-throw test. */
  _enqueueMutationForTest(
    apply: (snapshot: FavoritesEntry[]) => FavoritesEntry[],
    payload: FavoritesChangeEvent
  ): Promise<void> {
    return this.enqueueMutation(apply, payload);
  }

  private async enqueueMutation(
    apply: (snapshot: FavoritesEntry[]) => FavoritesEntry[],
    payload: FavoritesChangeEvent | (() => FavoritesChangeEvent)
  ): Promise<void> {
    await this.persistChain.catch(() => undefined);

    const snapshot = [...this.entries];

    let next: FavoritesEntry[];
    try {
      next = apply(snapshot);
    } catch (err) {
      throw err;
    }

    const snapshotKeys = new Set(snapshot.map(e => canonicalKey(e.path)));
    const nextKeys = new Set(next.map(e => canonicalKey(e.path)));
    const addedKeys = new Set(
      next.map(e => canonicalKey(e.path)).filter(key => !snapshotKeys.has(key))
    );
    const removedEntries = snapshot.filter(e => !nextKeys.has(canonicalKey(e.path)));

    this.entries = next;
    this.rebuildIndex();
    this._onDidChange.fire(typeof payload === "function" ? payload() : payload);

    this.persistChain = Promise.resolve(
      this.memento.update(STORAGE_KEY, { version: 2, entries: this.entries } as FavoritesStorageEnvelope)
    )
      .then(() => undefined)
      .catch((err: unknown) => {
        const rolledBack = this.entries.filter(e => !addedKeys.has(canonicalKey(e.path)));
        const rolledBackKeys = new Set(rolledBack.map(e => canonicalKey(e.path)));
        for (const entry of removedEntries) {
          const key = canonicalKey(entry.path);
          if (!rolledBackKeys.has(key)) {
            rolledBack.push(entry);
            rolledBackKeys.add(key);
          }
        }
        this.entries = rolledBack;
        this.rebuildIndex();
        this._onDidChange.fire({ kind: "broad" });
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `Couldn't save Favorites — please try again. (${msg})`
        );
      });

    return this.persistChain;
  }

  private rebuildIndex(): void {
    this.keyIndex = new Set(this.entries.map(e => canonicalKey(e.path)));
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
