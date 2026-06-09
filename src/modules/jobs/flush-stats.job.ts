import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CacheService, CacheKey } from '../cache/cache.service';
import { DatabaseService } from '../database/database.service';

/**
 * FlushStatsJob — cron job that periodically flushes Redis view/like
 * counters into Neon DB.
 *
 * ── Why this pattern? ──────────────────────────────────────────────────────
 * Reels can receive thousands of views per minute. Writing an UPDATE to the DB
 * on every single view would:
 *   1. Overwhelm Neon DB's connection pool
 *   2. Create hot-row contention on popular reels
 *   3. Increase API response latency (waiting for DB write)
 *
 * Instead:
 *   - Each view increments a Redis counter (sub-millisecond)
 *   - This cron reads all pending counters every 30 seconds
 *   - Executes a single batch UPDATE for all reels at once
 *   - Redis counters are reset atomically after reading
 *
 * This reduces DB write load by up to 1800× for a reel with 60 views/sec.
 * ──────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class FlushStatsJob {
  private readonly logger = new Logger(FlushStatsJob.name);

  constructor(
    private readonly cache: CacheService,
    private readonly db:    DatabaseService,
  ) {}

  /**
   * Flush pending view counts from Redis → Neon DB.
   * Runs every 30 seconds.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async flushViewCounts(): Promise<void> {
    try {
      // Find all pending view counter keys: reel:pending_views:*
      const keys = await this.cache.scanKeys('reel:pending_views:*');

      if (keys.length === 0) return;

      this.logger.debug(`Flushing view counts for ${keys.length} reels...`);

      // Read all counters and reset them atomically
      const updates = await Promise.all(
        keys.map(async (key) => {
          const reelId = key.replace('reel:pending_views:', '');
          const count  = await this.cache.getAndReset(key);
          return { reelId, count };
        }),
      );

      // Filter out zeros (race condition edge case)
      const nonZeroUpdates = updates.filter((u) => u.count > 0);

      if (nonZeroUpdates.length === 0) return;

      // Batch UPDATE in a single transaction
      await this.db.$transaction(
        nonZeroUpdates.map(({ reelId, count }) =>
          this.db.reel.update({
            where: { id: reelId },
            data:  { viewsCount: { increment: count } },
          }),
        ),
      );

      const totalViews = nonZeroUpdates.reduce((sum, u) => sum + u.count, 0);
      this.logger.log(
        `✅ Flushed ${totalViews} views across ${nonZeroUpdates.length} reels`,
      );
    } catch (err) {
      this.logger.error('FlushViewCounts cron failed:', err);
    }
  }

  /**
   * Flush pending like deltas from Redis → Neon DB.
   * Runs every 30 seconds.
   *
   * Note: Unlike views, likes are also written to the DB immediately
   * in ReelsRepository.toggleLike() for accuracy. The Redis delta is
   * a fast cache-side counter used for real-time UI updates.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async flushLikeCounts(): Promise<void> {
    try {
      const keys = await this.cache.scanKeys('reel:pending_likes:*');
      if (keys.length === 0) return;

      const deltas = await Promise.all(
        keys.map(async (key) => {
          const reelId = key.replace('reel:pending_likes:', '');
          const delta  = await this.cache.getAndReset(key);
          return { reelId, delta };
        }),
      );

      const nonZeroDeltas = deltas.filter((d) => d.delta !== 0);
      if (nonZeroDeltas.length === 0) return;

      await this.db.$transaction(
        nonZeroDeltas.map(({ reelId, delta }) =>
          this.db.reel.update({
            where: { id: reelId },
            data:  {
              likesCount: delta > 0
                ? { increment: delta }
                : { decrement: Math.abs(delta) },
            },
          }),
        ),
      );

      this.logger.debug(`Flushed like deltas for ${nonZeroDeltas.length} reels`);
    } catch (err) {
      this.logger.error('FlushLikeCounts cron failed:', err);
    }
  }
}
