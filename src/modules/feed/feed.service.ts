import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CacheService } from '../cache/cache.service';
import { PaginatedResult } from '../../common/types/api-response.type';

export enum FeedType {
  FOR_YOU   = 'for_you',
  FOLLOWING = 'following',
}

export class FeedQueryDto {
  limit: number = 12;
  cursor?: string;
  type: FeedType = FeedType.FOR_YOU;
}

/**
 * FeedService — provides a ranked, personalized feed combining posts + reels.
 *
 * Algorithm (For You):
 *   1. Fetch posts from followed users (last 48h) — highest priority
 *   2. Fetch trending posts (last 48h) — sorted by engagement velocity
 *   3. Interleave: 70% followed content, 30% trending/suggested
 *   4. Cache the resulting feed per-user for 5 minutes
 *
 * Algorithm (Following):
 *   - Chronological posts from people you follow (no suggested content)
 *
 * Scoring for trending:
 *   score = (likes * 2) + (comments * 3) + (views * 0.5) / hours_since_posted
 */
@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Returns trending content for the Explore page.
   * Shows top-scored content from the last 7 days without follow-priority.
   */
  async getExploreContent(limit: number = 30): Promise<any[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = Date.now();

    const recentPosts = await this.db.post.findMany({
      where: { isDeleted: false, createdAt: { gte: sevenDaysAgo } },
      include: this.postIncludes(),
      take: 100,
    });

    const recentReels = await this.db.reel.findMany({
      where: { isDeleted: false, status: 'READY', createdAt: { gte: sevenDaysAgo } },
      include: this.reelIncludes(),
      take: 100,
    });

    const scored = [...recentPosts, ...recentReels].map((item: any) => {
      const hoursAgo = (now - item.createdAt.getTime()) / (1000 * 60 * 60) || 1;
      const likes = Number(item.likesCount ?? 0);
      const comments = Number(item.commentsCount ?? 0);
      const views = Number(item.viewsCount ?? 0);
      const engagementScore = (likes * 2) + (comments * 3) + (views * 0.5);
      const score = engagementScore / Math.pow(hoursAgo + 1, 1.5);

      const isReel = !!(item as any).hlsUrl;
      return {
        item: isReel ? { ...this.formatReel(item), type: 'reel' } : { ...this.formatPost(item), type: 'post' },
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.item);
  }

  /**
   * Returns a unified feed (posts + reels) for the home screen.
   * For unauthenticated users, returns trending content only.
   */
  async getFeed(userId: string | undefined, query: FeedQueryDto): Promise<PaginatedResult<any>> {
    const feedType = query.type ?? FeedType.FOR_YOU;
    const limit = query.limit;
    const cacheKey = `feed:unified:${feedType}:${userId || 'anonymous'}:v2`;

    // Try cache first (5 min TTL)
    if (!query.cursor) {
      const cached = await this.cache.get<any[]>(cacheKey);
      if (cached && cached.length > 0) {
        this.logger.debug(`Cache hit for feed [${feedType}] user:${userId} — ${cached.length} items`);
        return this.paginateFromCached(cached, limit, undefined);
      }
    }

    let items: any[] = [];

    if (feedType === FeedType.FOLLOWING && userId) {
      // Chronological following feed — pure recency
      items = await this.getFollowingFeed(userId, 50);
    } else {
      // For You — ranked algorithm
      items = await this.getForYouFeed(userId);
    }

    // Cache the full result set (not just one page)
    if (items.length > 0 && !query.cursor) {
      await this.cache.set(cacheKey, items, 300); // 5 minutes
    }

    return this.paginateFromCached(items, limit, query.cursor);
  }

  /**
   * Following feed — chronological posts from users the current user follows.
   */
  private async getFollowingFeed(userId: string, maxItems: number = 50): Promise<any[]> {
    // Get IDs of users this user follows
    const following = await this.db.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const followingIds = following.map((f) => f.followingId);
    // Include user's own posts
    followingIds.push(userId);

    if (followingIds.length === 0) return [];

    // Fetch posts from followed users — last 7 days, chronological
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const posts = await this.db.post.findMany({
      where: {
        userId: { in: followingIds },
        isDeleted: false,
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      take: maxItems,
      include: this.postIncludes(),
    });

    const reels = await this.db.reel.findMany({
      where: {
        userId: { in: followingIds },
        isDeleted: false,
        status: 'READY',
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      take: maxItems,
      include: this.reelIncludes(),
    });

    // Interleave posts + reels chronologically
    const combined = this.interleaveByTime(posts, reels);
    return combined.slice(0, maxItems);
  }

  /**
   * For You feed — scored by engagement velocity with follow-priority boost.
   */
  private async getForYouFeed(userId: string, maxItems: number = 50): Promise<any[]> {
    const now = Date.now();

    // ── 1. Get followed user IDs ──
    let followingIds: string[] = [];
    if (userId) {
      const following = await this.db.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      followingIds = following.map((f) => f.followingId);
      followingIds.push(userId); // own posts
    }

    // ── 2. Fetch posts from last 48 hours ──
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);

    const recentPosts = await this.db.post.findMany({
      where: {
        isDeleted: false,
        createdAt: { gte: twoDaysAgo },
      },
      include: this.postIncludes(),
      take: 100,
    });

    const recentReels = await this.db.reel.findMany({
      where: {
        isDeleted: false,
        status: 'READY',
        createdAt: { gte: twoDaysAgo },
      },
      include: this.reelIncludes(),
      take: 100,
    });

    // ── 3. Score and rank ──
    const scored: Array<{ item: any; score: number; isFollowed: boolean }> = [];

    const followingSet = new Set(followingIds);

    for (const post of recentPosts) {
      const hoursAgo = (now - post.createdAt.getTime()) / (1000 * 60 * 60) || 1;
      const engagement = (post.likesCount ?? 0) * 2 + (post.commentsCount ?? 0) * 3;
      const score = engagement / Math.pow(hoursAgo + 1, 1.5);
      const isFollowed = followingSet.has(post.userId);

      scored.push({
        item: { ...this.formatPost(post), type: 'post' },
        score: isFollowed ? score * 3 : score, // 3x boost for followed users
        isFollowed,
      });
    }

    for (const reel of recentReels) {
      const hoursAgo = (now - reel.createdAt.getTime()) / (1000 * 60 * 60) || 1;
      const engagement = Number(reel.likesCount ?? 0) * 2 + (reel.commentsCount ?? 0) * 3 + Number(reel.viewsCount ?? 0) * 0.5;
      const score = engagement / Math.pow(hoursAgo + 1, 1.5);
      const isFollowed = followingSet.has(reel.userId);

      scored.push({
        item: { ...this.formatReel(reel), type: 'reel' },
        score: isFollowed ? score * 3 : score,
        isFollowed,
      });
    }

    // ── 4. Sort by score descending ──
    scored.sort((a, b) => b.score - a.score);

    // ── 5. Ensure diversity: at least 60% followed content in top section ──
    const followed = scored.filter((s) => s.isFollowed);
    const suggested = scored.filter((s) => !s.isFollowed);

    const interleaved: any[] = [];
    let fi = 0, si = 0;

    // Round-robin: 2 followed, 1 suggested, repeat
    while (interleaved.length < maxItems && (fi < followed.length || si < suggested.length)) {
      // Take 2 followed
      for (let i = 0; i < 2 && fi < followed.length; i++) {
        interleaved.push(followed[fi++].item);
      }
      // Take 1 suggested
      if (si < suggested.length) {
        interleaved.push(suggested[si++].item);
      }
    }

    return interleaved.slice(0, maxItems);
  }

  /**
   * Interleave two date-sorted arrays chronologically (newest first).
   * Uses `any` typing because Post and Reel have different shapes
   * but both have a `createdAt: Date` field.
   */
  private interleaveByTime(arr1: any[], arr2: any[]): any[] {
    const combined: any[] = [];
    let i = 0, j = 0;
    while (i < arr1.length || j < arr2.length) {
      if (i < arr1.length && (j >= arr2.length || arr1[i].createdAt > arr2[j].createdAt)) {
        combined.push(arr1[i++]);
      } else if (j < arr2.length) {
        combined.push(arr2[j++]);
      } else {
        break;
      }
    }
    return combined;
  }

  /**
   * Paginate from a pre-fetched cached array.
   */
  private paginateFromCached(items: any[], limit: number, cursor?: string): PaginatedResult<any> {
    const startIndex = cursor ? parseInt(cursor, 10) : 0;
    if (isNaN(startIndex) || startIndex >= items.length) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const endIndex = startIndex + limit;
    const page = items.slice(startIndex, endIndex);
    const hasMore = endIndex < items.length;
    const nextCursor = hasMore ? endIndex.toString() : null;

    return { items: page, nextCursor, hasMore };
  }

  // ── Format helpers ──

  private postIncludes() {
    return {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isVerified: true } },
      media: { orderBy: { orderIndex: 'asc' as const } },
    };
  }

  private reelIncludes() {
    return {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isVerified: true } },
    };
  }

  private formatPost(post: any) {
    return {
      id: post.id,
      userId: post.userId,
      caption: post.caption,
      location: post.location,
      likesCount: post.likesCount ?? 0,
      commentsCount: post.commentsCount ?? 0,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      media: post.media?.map((m: any) => ({
        id: m.id,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType,
        orderIndex: m.orderIndex,
      })) ?? [],
      user: post.user ? {
        id: post.user.id,
        username: post.user.username,
        displayName: post.user.displayName,
        avatarUrl: post.user.avatarUrl,
        isVerified: post.user.isVerified,
      } : undefined,
    };
  }

  private formatReel(reel: any) {
    return {
      id: reel.id,
      userId: reel.userId,
      caption: reel.caption,
      audioName: reel.audioName,
      hashtags: reel.hashtags,
      status: reel.status,
      durationSeconds: reel.durationSeconds,
      hlsUrl: reel.hlsUrl,
      thumbnailUrl: reel.thumbnailUrl,
      viewsCount: reel.viewsCount?.toString() ?? '0',
      likesCount: reel.likesCount?.toString() ?? '0',
      commentsCount: reel.commentsCount ?? 0,
      sharesCount: reel.sharesCount ?? 0,
      createdAt: reel.createdAt,
      user: reel.user ? {
        id: reel.user.id,
        username: reel.user.username,
        displayName: reel.user.displayName,
        avatarUrl: reel.user.avatarUrl,
        isVerified: reel.user.isVerified,
      } : undefined,
    };
  }
}