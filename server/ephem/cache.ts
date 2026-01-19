type CacheEntry<T> = {
  value: T;
  expiresAt: number | null;
};

export class LruCache<T> {
  private readonly maxEntries: number;
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number) {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.store.set(key, { value, expiresAt });
    if (this.store.size <= this.maxEntries) return;
    const oldestKey = this.store.keys().next().value;
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}
