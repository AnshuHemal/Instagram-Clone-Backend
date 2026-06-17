import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * HashtagService — manages hashtag extraction, trending, and search.
 *
 * Hashtags are stored as individual records so we can:
 * - Track usage count per hashtag
 * - Show trending hashtags on the Explore page
 * - Link posts/reels to hashtag pages
 */

const HASHTAG_REGEX = /#(\w+)/g;
const MENTION_REGEX = /@(\w+)/g;

@Injectable()
export class HashtagService {
  private readonly logger = new Logger(HashtagService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Extracts hashtags from text and ensures they exist in the DB.
   * Returns an array of unique tag strings found.
   */
  extractAndUpsert(text: string): string[] {
    if (!text) return [];
    const tags = [...text.matchAll(HASHTAG_REGEX)].map((m) => m[1].toLowerCase());
    const unique = [...new Set(tags)];

    // Fire-and-forget upsert for each hashtag (non-blocking)
    for (const tag of unique) {
      this.db.hashtag.upsert({
        where: { tag },
        create: { tag, postCount: 1 },
        update: { postCount: { increment: 1 } },
      }).catch((err) => this.logger.warn(`Hashtag upsert failed for #${tag}:`, err?.message));
    }

    return unique;
  }

  /**
   * Extracts @mentions from text.
   */
  extractMentions(text: string): string[] {
    if (!text) return [];
    return [...text.matchAll(MENTION_REGEX)].map((m) => m[1].toLowerCase());
  }

  /**
   * Search hashtags by prefix (for auto-suggest).
   */
  async searchHashtags(query: string, limit = 10) {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    const hashtags = await this.db.hashtag.findMany({
      where: { tag: { contains: term } },
      orderBy: { postCount: 'desc' },
      take: limit,
    });

    return hashtags.map((h) => ({
      tag: h.tag,
      postCount: h.postCount,
    }));
  }

  /**
   * Get trending hashtags (most used in last 48h).
   */
  async getTrendingHashtags(limit = 10) {
    const hashtags = await this.db.hashtag.findMany({
      orderBy: { postCount: 'desc' },
      take: limit,
    });

    return hashtags.map((h) => ({
      tag: h.tag,
      postCount: h.postCount,
    }));
  }

  /**
   * Get content (posts + reels) for a specific hashtag.
   */
  async getHashtagFeed(tag: string, limit = 20, cursor?: string) {
    const tagLower = tag.toLowerCase();

    const hashtag = await this.db.hashtag.findUnique({
      where: { tag: tagLower },
    });

    if (!hashtag) {
      return { items: [], hasMore: false, nextCursor: null };
    }

    // Fetch linked content IDs from ContentHashtag
    const contentTags = await this.db.contentHashtag.findMany({
      where: { hashtagId: hashtag.id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = contentTags.length > limit;
    const items = hasMore ? contentTags.slice(0, limit) : contentTags;

    // Fetch the actual content items
    const postIds: string[] = [];
    const reelIds: string[] = [];

    for (const ct of items) {
      if (ct.contentType === 'POST') postIds.push(ct.contentId);
      else if (ct.contentType === 'REEL') reelIds.push(ct.contentId);
    }

    const [posts, reels] = await Promise.all([
      postIds.length > 0 ? this.db.post.findMany({
        where: { id: { in: postIds }, isDeleted: false },
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isVerified: true } },
          media: { orderBy: { orderIndex: 'asc' } },
        },
      }) : [],
      reelIds.length > 0 ? this.db.reel.findMany({
        where: { id: { in: reelIds }, isDeleted: false, status: 'READY' },
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isVerified: true } },
        },
      }) : [],
    ]);

    const combined = [
      ...posts.map((p) => ({ ...p, type: 'post' as const })),
      ...reels.map((r) => ({ ...r, type: 'reel' as const })),
    ];

    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items: combined, nextCursor, hasMore };
  }
}