import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReelStatus } from '@prisma/client';

import { ReelsRepository } from './reels.repository';
import { CacheService, CacheKey, TTL } from '../cache/cache.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateReelDto } from './dto/create-reel.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { RecordViewDto } from './dto/record-view.dto';
import { PaginatedResult } from '../../common/types/api-response.type';
import { NotificationsService } from '../notifications/notifications.service';
import { sanitizeAndTruncate } from '../../common/utils/sanitize';

/**
 * ReelsService — orchestrates business logic for the Reels feature.
 *
 * Layer responsibilities:
 *   Controller  → validates request, calls service
 *   Service     → business logic, caching, event emission
 *   Repository  → raw Prisma queries, no business logic
 *   Cache       → Redis read-through / write-behind
 */
@Injectable()
export class ReelsService {
  private readonly logger = new Logger(ReelsService.name);

  constructor(
    private readonly repo:        ReelsRepository,
    private readonly cache:       CacheService,
    private readonly cloudinary:  CloudinaryService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Upload Signature ──────────────────────────────────────────────────────

  /**
   * Generates a signed Cloudinary upload signature.
   * The client uses this to upload directly to Cloudinary (bypassing us).
   * Valid for ~1 hour (enforced by Cloudinary's timestamp window).
   */
  getUploadSignature(userId: string) {
    return this.cloudinary.generateUploadSignature(userId);
  }

  // ── Create Reel ───────────────────────────────────────────────────────────

  /**
   * Creates a reel record in Neon DB immediately after the client uploads
   * the video to Cloudinary. At this point, status = PROCESSING.
   *
   * The reel transitions to READY when the Cloudinary webhook fires
   * (see WebhooksService).
   */
  async createReel(userId: string, dto: CreateReelDto) {
    if (dto.caption !== undefined) dto.caption = sanitizeAndTruncate(dto.caption, 2200);
    const reel = await this.repo.create({
      userId,
      cloudinaryPublicId: dto.cloudinaryPublicId,
      caption:   dto.caption,
      audioName: dto.audioName,
      hashtags:  dto.hashtags ?? [],
    });

    this.logger.log(`Reel created [${reel.id}] by user ${userId} — status: PROCESSING`);

    return this.formatReelResponse(reel);
  }

  // ── Feed ──────────────────────────────────────────────────────────────────

  /**
   * Returns a cursor-paginated feed of ready reels.
   *
   * Read-through cache pattern:
   *   1. Check Redis for cached feed page
   *   2. On miss → query Neon DB → cache result → return
   *   3. Cache TTL = 5 minutes (short, so new reels appear quickly)
   */
  async getFeed(userId: string, query: FeedQueryDto): Promise<PaginatedResult<any>> {
    const limit = query.limit;
    const cursor = query.cursor; // This will be the index in the ID array, e.g. "8"
    const userKey = userId || 'anonymous';
    const idsCacheKey = `feed:random:ids:${userKey}`;

    let shuffledIds: string[] = [];

    if (!cursor) {
      this.logger.debug(`Generating new randomized feed for user: ${userKey}`);
      const allIds = await this.repo.findAllReadyIds();
      shuffledIds = this.shuffle(allIds);
      await this.cache.set(idsCacheKey, shuffledIds, 600); // 10 minutes TTL
    } else {
      this.logger.debug(`Retrieving cached randomized feed for user: ${userKey}, cursor: ${cursor}`);
      const cachedIds = await this.cache.get<string[]>(idsCacheKey);
      if (cachedIds && cachedIds.length > 0) {
        shuffledIds = cachedIds;
      } else {
        this.logger.warn(`Randomized feed cache miss for user ${userKey} during paging. Regenerating feed.`);
        const allIds = await this.repo.findAllReadyIds();
        shuffledIds = this.shuffle(allIds);
        await this.cache.set(idsCacheKey, shuffledIds, 600);
      }
    }

    const startIndex = cursor ? parseInt(cursor, 10) : 0;
    if (isNaN(startIndex) || startIndex >= shuffledIds.length) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
      };
    }

    const endIndex = startIndex + limit;
    const pageIds = shuffledIds.slice(startIndex, endIndex);
    const reels = await this.repo.findFeedByIds(pageIds);

    // Map database results to preserve the shuffled pageIds ordering
    const reelsMap = new Map(reels.map((r) => [r.id, r]));
    const orderedReels = pageIds.map((id) => reelsMap.get(id)).filter(Boolean);

    const enriched = orderedReels.map((reel) => this.formatReelResponse(reel));

    const hasMore = endIndex < shuffledIds.length;
    const nextCursor = hasMore ? endIndex.toString() : null;

    const response: PaginatedResult<any> = {
      items:      enriched,
      nextCursor,
      hasMore,
    };

    return this.enrichFeedWithUserData(response, userId);
  }

  /**
   * Adds the user's like state to each reel in the feed.
   * Checked against Redis first, then DB on miss.
   */
  private async enrichFeedWithUserData(
    result: PaginatedResult<any>,
    userId?: string,
  ): Promise<PaginatedResult<any>> {
    const enrichedItems = await Promise.all(
      result.items.map(async (reel) => {
        let isLiked = false;
        if (userId) {
          const cachedLiked = await this.cache.getUserLiked(userId, reel.id);
          if (cachedLiked !== null) {
            isLiked = cachedLiked;
          } else {
            isLiked = await this.repo.isLikedBy(reel.id, userId);
            await this.cache.setUserLiked(userId, reel.id, isLiked);
          }
        }

        let isFollowing = false;
        let isRequested = false;
        if (userId && userId !== reel.userId) {
          const [followRecord, requestRecord] = await Promise.all([
            this.repo.db.follow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: userId,
                  followingId: reel.userId,
                },
              },
            }),
            this.repo.db.followRequest.findUnique({
              where: {
                requesterId_targetId: {
                  requesterId: userId,
                  targetId: reel.userId,
                },
              },
            }),
          ]);
          isFollowing = !!followRecord;
          isRequested = requestRecord?.status === 'PENDING';
        }

        return { 
          ...reel, 
          isLiked,
          isFollowing,
          isRequested,
        };
      }),
    );
    return { ...result, items: enrichedItems };
  }

  // ── Single Reel ───────────────────────────────────────────────────────────

  async getReelById(id: string, userId?: string) {
    const cacheKey = CacheKey.reelMeta(id);
    const cached = await this.cache.get<any>(cacheKey);

    if (cached) {
      const isLiked = userId
        ? (await this.cache.getUserLiked(userId, id)) ?? (await this.repo.isLikedBy(id, userId))
        : false;
      return { ...cached, isLiked };
    }

    const reel = await this.repo.findById(id);
    if (!reel) throw new NotFoundException(`Reel ${id} not found`);

    const formatted = this.formatReelResponse(reel);
    await this.cache.set(cacheKey, formatted, TTL.REEL_META);

    const isLiked = userId ? await this.repo.isLikedBy(id, userId) : false;
    return { ...formatted, isLiked };
  }

  // ── Like / Unlike ─────────────────────────────────────────────────────────

  async toggleLike(reelId: string, userId: string) {
    // Verify reel exists
    const reel = await this.repo.findById(reelId);
    if (!reel) throw new NotFoundException(`Reel ${reelId} not found`);

    const { liked, likesCount } = await this.repo.toggleLike(reelId, userId);

    // Update Redis like state cache
    await this.cache.setUserLiked(userId, reelId, liked);

    // Invalidate reel metadata cache so updated like count is reflected
    await this.cache.del(CacheKey.reelMeta(reelId));

    this.logger.debug(`User ${userId} ${liked ? 'liked' : 'unliked'} reel ${reelId}`);

    if (liked) {
      await this.notificationsService.createNotification(
        reel.userId,
        userId,
        'LIKE_REEL',
        undefined,
        reelId,
      ).catch((err) => this.logger.error('Failed to trigger notification on reel like:', err));
    }

    return {
      liked,
      likesCount: likesCount.toString(),
    };
  }

  // ── View Recording ────────────────────────────────────────────────────────

  /**
   * Records a view event — fire-and-forget.
   *
   * Strategy (optimized for high volume):
   * 1. Increment Redis pending view counter (< 1ms)
   * 2. Write to reel_views table for analytics (async)
   * 3. Redis counter is flushed to Neon DB every 30s by cron job
   *
   * This means we never block the client response on a DB write,
   * and we never hit the DB with 10,000 individual UPDATE queries.
   */
  async recordView(reelId: string, userId: string, dto: RecordViewDto) {
    // Fast Redis increment (non-blocking)
    await this.cache.recordView(reelId);

    // Async DB write for analytics (don't await — fire and forget)
    this.repo.recordView({
      reelId,
      userId,
      watchDurationMs: dto.watchDurationMs,
      completed:       dto.completed,
      quality:         dto.quality,
    }).catch((err) => this.logger.error('recordView DB error:', err));

    return { recorded: true };
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteReel(reelId: string, userId: string) {
    const reel = await this.repo.findById(reelId);
    if (!reel) throw new NotFoundException(`Reel ${reelId} not found`);
    if (reel.userId !== userId) throw new ForbiddenException('Not your reel');

    const deleted = await this.repo.softDelete(reelId, userId);

    if (deleted) {
      // Clean up cache
      await this.cache.invalidateReel(reelId);

      // Delete Cloudinary asset asynchronously
      if (reel.cloudinaryPublicId) {
        this.cloudinary.deleteAsset(reel.cloudinaryPublicId)
          .catch((err) => this.logger.error('Cloudinary delete error:', err));
      }
    }

    return { deleted };
  }

  async updateReel(reelId: string, userId: string, data: { caption?: string; audioName?: string }) {
    const reel = await this.repo.findById(reelId);
    if (!reel) throw new NotFoundException(`Reel ${reelId} not found`);
    if (reel.userId !== userId) throw new ForbiddenException('Not your reel');

    const updated = await this.repo.db.reel.update({
      where: { id: reelId },
      data: {
        caption: data.caption,
        audioName: data.audioName,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            isVerified: true,
          },
        },
      },
    });

    await this.cache.invalidateReel(reelId);

    return this.formatReelResponse(updated);
  }

  // ── Webhook Processing ────────────────────────────────────────────────────

  /**
   * Called by WebhooksService when Cloudinary completes HLS transcoding.
   * Updates the reel status to READY and saves the CDN URLs.
   */
  async markReelReady(
    cloudinaryPublicId: string,
    hlsUrl:             string,
    thumbnailUrl:       string,
    durationSeconds:    number,
  ) {
    this.logger.log(`[Reels Service] markReelReady called for publicId: "${cloudinaryPublicId}"`);
    const reel = await this.repo.findByCloudinaryPublicId(cloudinaryPublicId);
    
    if (!reel) {
      this.logger.warn(`[Reels Service] Webhook warning: reel not found in DB for public_id: "${cloudinaryPublicId}"`);
      try {
        const allReels = await this.repo.db.reel.findMany({
          take: 10,
          select: { id: true, cloudinaryPublicId: true, status: true }
        });
        this.logger.log(`[Reels Service] Existing reels in DB (first 10): ${JSON.stringify(allReels, null, 2)}`);
      } catch (dbErr) {
        this.logger.error('[Reels Service] Failed to list existing reels for troubleshooting', dbErr);
      }
      return;
    }

    this.logger.log(`[Reels Service] Found reel ID "${reel.id}". Updating status from ${reel.status} to READY...`);
    await this.repo.updateStatus(reel.id, ReelStatus.READY, {
      hlsUrl,
      thumbnailUrl,
      durationSeconds,
    });

    // Clear cache and notify SSE listeners
    await this.cache.invalidateReel(reel.id);
    this.eventEmitter.emit('reel.ready', {
      reelId: reel.id,
      hlsUrl,
      thumbnailUrl,
      durationSeconds,
    });

    this.logger.log(`✅ [Reels Service] Reel [${reel.id}] marked READY — HLS: ${hlsUrl}`);
  }

  async markReelFailed(cloudinaryPublicId: string, reason: string) {
    const reel = await this.repo.findByCloudinaryPublicId(cloudinaryPublicId);
    if (!reel) return;

    await this.repo.updateStatus(reel.id, ReelStatus.FAILED);
    this.eventEmitter.emit('reel.failed', { reelId: reel.id, reason });
    this.logger.error(`Reel [${reel.id}] FAILED: ${reason}`);
  }

  async addComment(reelId: string, userId: string, text: string) {
    const reel = await this.repo.findById(reelId);
    if (!reel) throw new NotFoundException(`Reel ${reelId} not found`);

    const comment = await this.repo.addComment(reelId, userId, text);

    // Invalidate reel metadata cache to reflect comment count change
    await this.cache.del(CacheKey.reelMeta(reelId));

    // Create comment notification
    await this.notificationsService.createNotification(
      reel.userId,
      userId,
      'COMMENT_REEL',
      undefined,
      reelId,
      text,
    ).catch((err) => this.logger.error('Failed to trigger notification on reel comment:', err));

    return {
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt,
      user: {
        id: comment.user.id,
        username: comment.user.username,
        displayName: comment.user.displayName,
        avatarUrl: comment.user.avatarUrl,
        isVerified: comment.user.isVerified,
      },
    };
  }

  async getComments(reelId: string) {
    const reel = await this.repo.findById(reelId);
    if (!reel) throw new NotFoundException(`Reel ${reelId} not found`);

    const comments = await this.repo.findComments(reelId);
    return comments.map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt,
      user: {
        id: c.user.id,
        username: c.user.username,
        displayName: c.user.displayName,
        avatarUrl: c.user.avatarUrl,
        isVerified: c.user.isVerified,
      },
    }));
  }

  async getUserReels(targetUserId: string, limit: number, cursor?: string, currentUserId?: string) {
    const result = await this.repo.findUserReels(targetUserId, limit, cursor);
    const items = await Promise.all(
      result.items.map(async (r) => {
        const isLiked = currentUserId ? await this.repo.isLikedBy(r.id, currentUserId) : false;

        let isFollowing = false;
        let isRequested = false;
        if (currentUserId && currentUserId !== r.userId) {
          const [followRecord, requestRecord] = await Promise.all([
            this.repo.db.follow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: currentUserId,
                  followingId: r.userId,
                },
              },
            }),
            this.repo.db.followRequest.findUnique({
              where: {
                requesterId_targetId: {
                  requesterId: currentUserId,
                  targetId: r.userId,
                },
              },
            }),
          ]);
          isFollowing = !!followRecord;
          isRequested = requestRecord?.status === 'PENDING';
        }

        return {
          ...this.formatReelResponse(r),
          isLiked,
          isFollowing,
          isRequested,
        };
      })
    );

    return {
      success: true,
      data: {
        reels: items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Formats a raw Prisma reel row into the API response shape.
   * Adds Cloudinary CDN URLs and serializes BigInt fields to strings.
   */
  private formatReelResponse(reel: any) {
    return {
      id:              reel.id,
      userId:          reel.userId,
      caption:         reel.caption,
      audioName:       reel.audioName,
      hashtags:        reel.hashtags,
      status:          reel.status,
      durationSeconds: reel.durationSeconds,
      createdAt:       reel.createdAt,

      // Cloudinary CDN URLs — served from 200+ global edge nodes
      hlsUrl:       reel.hlsUrl  ?? (reel.cloudinaryPublicId ? this.cloudinary.buildHlsUrl(reel.cloudinaryPublicId)       : null),
      thumbnailUrl: reel.thumbnailUrl ?? (reel.cloudinaryPublicId ? this.cloudinary.buildThumbnailUrl(reel.cloudinaryPublicId) : null),
      feedThumbnail: reel.cloudinaryPublicId ? this.cloudinary.buildFeedThumbnailUrl(reel.cloudinaryPublicId) : null,

      // Serialize BigInt to string (JSON.stringify can't handle BigInt natively)
      viewsCount: reel.viewsCount?.toString() ?? '0',
      likesCount: reel.likesCount?.toString() ?? '0',
      commentsCount: reel.commentsCount ?? 0,
      sharesCount:   reel.sharesCount   ?? 0,

      // Author info
      author: reel.user ? {
        id:          reel.user.id,
        username:    reel.user.username,
        displayName: reel.user.displayName,
        avatarUrl:   reel.user.avatarUrl,
        isVerified:  reel.user.isVerified,
        isPrivate:   reel.user.isPrivate,
      } : undefined,
    };
  }

  private shuffle(array: string[]): string[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async getTrendingSounds(limit = 8) {
    const results = await this.repo.db.reel.groupBy({
      by: ['audioName'],
      where: {
        audioName: { not: null },
        status: 'READY',
      },
      _count: { audioName: true },
      orderBy: { _count: { audioName: 'desc' } },
      take: limit,
    });

    return {
      success: true,
      data: results
        .filter((r: any) => r.audioName && r.audioName !== 'Original Audio')
        .map((r: any) => ({
          audioName: r.audioName,
          reelCount: r._count.audioName,
        })),
    };
  }

  /**
   * Returns the top trending reels ordered by combined likes + views score.
   * Used to populate the in-feed Trending Reels carousel widget.
   */
  async getTrendingReels(userId: string | undefined, limit = 10) {
    const reels = await this.repo.db.reel.findMany({
      where: {
        status: 'READY',
        isDeleted: false,
      },
      orderBy: [
        { likesCount: 'desc' },
        { viewsCount: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      include: {
        user: {
          select: {
            id:          true,
            username:    true,
            displayName: true,
            avatarUrl:   true,
            isVerified:  true,
          },
        },
      },
    });

    const formatted = reels.map((reel: any) => this.formatReelResponse(reel));

    return {
      success: true,
      data: formatted,
    };
  }
}
