/**
 * TTL cache with stale-while-revalidate and single-flight loading.
 *
 * This is the load-bearing component of the whole service. Three behaviours
 * matter, and they are three different problems:
 *
 * 1. TTL          — how long a value is considered current.
 * 2. Single-flight — when N requests miss the same key at the same instant,
 *                    exactly one upstream call is made. Without this, a cold
 *                    key under load produces a thundering herd: the busier we
 *                    are, the harder we hammer the provider, which is the
 *                    precise moment we can least afford to.
 * 3. Stale-while-revalidate — past the TTL we serve the old value immediately
 *                    and refresh in the background. The user gets a fast
 *                    response and never waits on the provider, and if the
 *                    provider is down we keep serving the last good value
 *                    instead of an error page.
 *
 * The trade-off in (3) is explicit: a request just past the TTL sees data up to
 * `ttlMs` old. For weather that is the right call — a temperature ten minutes
 * stale is still true, whereas a spinner is always wrong.
 *
 * Deliberately kept free of any metrics or logging dependency: it reports what
 * happened through `onEvent` and the caller decides what that means. That is
 * what makes it testable without a Prometheus registry.
 */

export type CacheState = 'fresh' | 'stale';

export type CacheEventType =
  | 'hit_fresh'
  | 'hit_stale'
  | 'miss'
  | 'coalesced'
  | 'evicted'
  | 'revalidate_failed';

export interface CacheResult<T> {
  value: T;
  state: CacheState;
  /** Epoch millis the value was retrieved from upstream. Surfaced to the UI. */
  fetchedAt: number;
}

export interface TtlCacheOptions {
  /** Used as a metric label, so keep it short and stable. */
  name: string;
  /** Below this age a value is served as-is. */
  ttlMs: number;
  /** Above the TTL and below this, a value is served stale and refreshed. */
  staleMs: number;
  /** Hard bound on entries. An unbounded Map is a memory leak with extra steps. */
  maxEntries: number;
  now?: () => number;
  onEvent?: (type: CacheEventType, cacheName: string) => void;
  onRevalidateError?: (error: unknown, key: string, cacheName: string) => void;
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

export class TtlCache<T> {
  readonly name: string;
  private readonly ttlMs: number;
  private readonly staleMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly onEvent: ((type: CacheEventType, cacheName: string) => void) | undefined;
  private readonly onRevalidateError:
    | ((error: unknown, key: string, cacheName: string) => void)
    | undefined;

  /** Insertion order is the LRU order; `touch` moves a key back to the end. */
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<Entry<T>>>();

  constructor(options: TtlCacheOptions) {
    if (options.staleMs <= options.ttlMs) {
      throw new Error(
        `TtlCache "${options.name}": staleMs must be greater than ttlMs, otherwise there is no window in which to serve stale data.`,
      );
    }
    if (options.maxEntries < 1) {
      throw new Error(`TtlCache "${options.name}": maxEntries must be at least 1.`);
    }

    this.name = options.name;
    this.ttlMs = options.ttlMs;
    this.staleMs = options.staleMs;
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent;
    this.onRevalidateError = options.onRevalidateError;
  }

  async fetch(key: string, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const entry = this.entries.get(key);

    if (entry) {
      const age = this.now() - entry.fetchedAt;

      if (age < this.ttlMs) {
        this.touch(key, entry);
        this.emit('hit_fresh');
        return { value: entry.value, state: 'fresh', fetchedAt: entry.fetchedAt };
      }

      if (age < this.staleMs) {
        this.touch(key, entry);
        this.emit('hit_stale');
        this.revalidateInBackground(key, loader);
        return { value: entry.value, state: 'stale', fetchedAt: entry.fetchedAt };
      }
    }

    // Cold, or so old that serving it would be a lie. This is the only path
    // where the caller waits on the provider.
    this.emit('miss');
    const loaded = await this.load(key, loader);
    return { value: loaded.value, state: 'fresh', fetchedAt: loaded.fetchedAt };
  }

  /**
   * Resolves once nothing is in flight. Used by the tests to observe background
   * revalidation, and by the server to drain cleanly on shutdown.
   */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight.values()]);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private load(key: string, loader: () => Promise<T>): Promise<Entry<T>> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.emit('coalesced');
      return existing;
    }

    const promise = (async () => {
      const value = await loader();
      const entry: Entry<T> = { value, fetchedAt: this.now() };
      this.set(key, entry);
      return entry;
    })().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  private revalidateInBackground(key: string, loader: () => Promise<T>): void {
    // Already refreshing: the in-flight call will update the entry for everyone.
    if (this.inflight.has(key)) return;

    void this.load(key, loader).catch((error: unknown) => {
      // Deliberately keep the stale entry. The provider being down is exactly
      // when the last good value is most valuable. The entry stays stale, so
      // the next request retries — self-limiting, because single-flight caps
      // us at one outstanding upstream call per key.
      this.emit('revalidate_failed');
      this.onRevalidateError?.(error, key, this.name);
    });
  }

  private touch(key: string, entry: Entry<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private set(key: string, entry: Entry<T>): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
        this.emit('evicted');
      }
    }
    this.touch(key, entry);
  }

  private emit(type: CacheEventType): void {
    this.onEvent?.(type, this.name);
  }
}
