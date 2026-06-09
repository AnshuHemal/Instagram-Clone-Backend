import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from '@upstash/redis';

// ── Cache TTL Constants (seconds) ─────────────────────────────────────────────
export const TTL = {
  FEED_GLOBAL:    5 * 60,       // 5 minutes  — paginated reel feed
  REEL_META:      30 * 60,      // 30 minutes — individual reel metadata
  REEL_STATS:     60,           // 60 seconds — like/view counts (frequently updated)
  UPLOAD_SIG:     60,           // 1 minute   — Cloudinary upload signatures
} as const;

// ── Cache Key Builders ─────────────────────────────────────────────────────────
export const CacheKey = {
  feedGlobal: (cursor: string) => `feed:global:${cursor || 'first'}`,
  reelMeta: (reelId: string) => `reel:meta:${reelId}`,
  reelStats: (reelId: string) => `reel:stats:${reelId}`,
  pendingViews: (reelId: string) => `reel:pending_views:${reelId}`,
  pendingLikeDelta: (reelId: string) => `reel:pending_likes:${reelId}`,
  userLiked: (userId: string, reelId: string) => `user:liked:${userId}:${reelId}`,
} as const;

/**
 * CacheService — Upstash Redis wrapper.
 *
 * Provides:
 * - Generic get/set/delete with type safety
 * - Atomic increment for view/like counting (INCR)
 * - Pattern-based cache invalidation
 * - Scan-based key listing for batch flush operations
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;
  private useInMemoryFallback = false;
  private readonly inMemoryCache = new Map<string, { value: any; expiresAt?: number }>();

  constructor(
    @Inject('REDIS_CONFIG')
    private readonly redisConfig: { url: string; token: string },
  ) {
    this.redis = new Redis({
      url: this.redisConfig.url || 'https://dummy.upstash.io',
      token: this.redisConfig.token || 'dummy',
    });

    const isPlaceholder =
      !this.redisConfig.url ||
      !this.redisConfig.token ||
      this.redisConfig.url.includes('your-redis-id') ||
      this.redisConfig.token.includes('your_upstash_token');

    if (isPlaceholder) {
      this.useInMemoryFallback = true;
      this.logger.warn('⚠️ Upstash Redis is not configured (using placeholders). Falling back to in-memory cache.');
    } else {
      this.logger.log('✅ Upstash Redis client initialized');
    }
  }

  private handleRedisError(context: string, err: any) {
    this.logger.error(`Redis error during [${context}]:`, err);
    const errMsg = String(err?.message || err || '').toLowerCase();
    if (errMsg.includes('fetch failed') || errMsg.includes('unauthorized') || errMsg.includes('forbidden')) {
      this.useInMemoryFallback = true;
      this.logger.warn('⚠️ Upstash Redis connection failed permanently or is unauthorized. Switched to in-memory fallback cache.');
    }
  }

  // ── Generic Operations ─────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    if (this.useInMemoryFallback) {
      const entry = this.inMemoryCache.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        this.inMemoryCache.delete(key);
        return null;
      }
      return entry.value as T;
    }

    try {
      return await this.redis.get<T>(key);
    } catch (err) {
      this.handleRedisError(`GET ${key}`, err);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (this.useInMemoryFallback) {
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
      this.inMemoryCache.set(key, { value, expiresAt });
      return;
    }

    try {
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      } else {
        await this.redis.set(key, JSON.stringify(value));
      }
    } catch (err) {
      this.handleRedisError(`SET ${key}`, err);
    }
  }

  async del(key: string): Promise<void> {
    if (this.useInMemoryFallback) {
      this.inMemoryCache.delete(key);
      return;
    }

    try {
      await this.redis.del(key);
    } catch (err) {
      this.handleRedisError(`DEL ${key}`, err);
    }
  }

  async exists(key: string): Promise<boolean> {
    if (this.useInMemoryFallback) {
      const entry = this.inMemoryCache.get(key);
      if (!entry) return false;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        this.inMemoryCache.delete(key);
        return false;
      }
      return true;
    }

    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (err) {
      this.handleRedisError(`EXISTS ${key}`, err);
      return false;
    }
  }

  // ── Atomic Counter Operations ──────────────────────────────────────────────

  /**
   * Atomically increments a counter key.
   * Used for pending view/like accumulation before batch DB flush.
   * @returns New counter value after increment
   */
  async increment(key: string, by = 1): Promise<number> {
    if (this.useInMemoryFallback) {
      const entry = this.inMemoryCache.get(key);
      let currentVal = 0;
      if (entry && (!entry.expiresAt || entry.expiresAt > Date.now())) {
        currentVal = Number(entry.value) || 0;
      }
      const newVal = currentVal + by;
      this.inMemoryCache.set(key, { value: newVal });
      return newVal;
    }

    try {
      return await this.redis.incrby(key, by);
    } catch (err) {
      this.handleRedisError(`INCRBY ${key}`, err);
      return 0;
    }
  }

  /**
   * Gets the current value of a counter key then resets it to 0 atomically.
   * Used by the stats flush cron job.
   */
  async getAndReset(key: string): Promise<number> {
    if (this.useInMemoryFallback) {
      const entry = this.inMemoryCache.get(key);
      let val = 0;
      if (entry && (!entry.expiresAt || entry.expiresAt > Date.now())) {
        val = Number(entry.value) || 0;
      }
      this.inMemoryCache.delete(key);
      return val;
    }

    try {
      // GETDEL + reset pattern — atomic read and clear
      const pipeline = this.redis.pipeline();
      pipeline.get(key);
      pipeline.del(key);
      const [value] = await pipeline.exec();
      return parseInt(String(value ?? '0'), 10) || 0;
    } catch (err) {
      this.handleRedisError(`getAndReset ${key}`, err);
      return 0;
    }
  }

  // ── Pattern Operations ─────────────────────────────────────────────────────

  /**
   * Scans for all keys matching a pattern.
   * Used by the flush cron to find all pending reel stats keys.
   * @example scanKeys('reel:pending_views:*')
   */
  async scanKeys(pattern: string): Promise<string[]> {
    if (this.useInMemoryFallback) {
      // Convert glob pattern to regular expression (escape regex chars, translate * to .*)
      const regexPattern = new RegExp(
        '^' + pattern.replace(/[-/\\^$*+?.()|[\]{}]/g, (m) => (m === '*' ? '.*' : '\\' + m)) + '$'
      );
      const matchedKeys: string[] = [];
      const now = Date.now();
      for (const [key, entry] of this.inMemoryCache.entries()) {
        if (entry.expiresAt && entry.expiresAt < now) {
          this.inMemoryCache.delete(key);
          continue;
        }
        if (regexPattern.test(key)) {
          matchedKeys.push(key);
        }
      }
      return matchedKeys;
    }

    try {
      const keys: string[] = [];
      let cursor = 0;
      do {
        const [nextCursor, batch] = await this.redis.scan(cursor, {
          match: pattern,
          count: 100,
        });
        cursor = Number(nextCursor); // Upstash may return string cursor
        keys.push(...batch);
      } while (cursor !== 0);
      return keys;
    } catch (err) {
      this.handleRedisError(`SCAN ${pattern}`, err);
      return [];
    }
  }

  /**
   * Deletes all keys matching a pattern (e.g. clear all feed cache).
   * Uses SCAN to avoid blocking KEYS command.
   */
  async deletePattern(pattern: string): Promise<void> {
    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) return;
    try {
      if (this.useInMemoryFallback) {
        for (const key of keys) {
          this.inMemoryCache.delete(key);
        }
        this.logger.debug(`[In-Memory] Deleted ${keys.length} keys matching: ${pattern}`);
        return;
      }
      await this.redis.del(...keys);
      this.logger.debug(`Deleted ${keys.length} keys matching: ${pattern}`);
    } catch (err) {
      this.handleRedisError(`deletePattern ${pattern}`, err);
    }
  }

  // ── Reel-Specific Helpers ─────────────────────────────────────────────────

  /**
   * Records a view event in Redis (fire-and-forget).
   * The actual DB write is deferred to the stats flush cron.
   */
  async recordView(reelId: string): Promise<void> {
    await this.increment(CacheKey.pendingViews(reelId));
  }

  /**
   * Records a like/unlike delta (+1 or -1) in Redis.
   */
  async recordLikeDelta(reelId: string, delta: 1 | -1): Promise<void> {
    await this.increment(CacheKey.pendingLikeDelta(reelId), delta);
  }

  /**
   * Caches whether a user has liked a reel (for instant UI feedback).
   */
  async setUserLiked(userId: string, reelId: string, liked: boolean): Promise<void> {
    const key = CacheKey.userLiked(userId, reelId);
    if (liked) {
      await this.set(key, '1', TTL.REEL_STATS);
    } else {
      await this.del(key);
    }
  }

  async getUserLiked(userId: string, reelId: string): Promise<boolean | null> {
    const key = CacheKey.userLiked(userId, reelId);
    const val = await this.get<string>(key);
    if (val === null) return null; // Cache miss — check DB
    return val === '1';
  }

  // ── Cache Invalidation ────────────────────────────────────────────────────

  /**
   * Invalidates all cached data for a specific reel.
   * Called after webhook updates a reel from PROCESSING → READY.
   */
  async invalidateReel(reelId: string): Promise<void> {
    await Promise.all([
      this.del(CacheKey.reelMeta(reelId)),
      this.del(CacheKey.reelStats(reelId)),
    ]);
    // Also clear the feed cache so the new reel appears
    await this.deletePattern('feed:global:*');
    this.logger.debug(`Cache invalidated for reel: ${reelId}`);
  }
}
