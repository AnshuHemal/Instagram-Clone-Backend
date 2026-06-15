import { Injectable } from '@nestjs/common';
import { Reel, ReelStatus, Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { PaginatedResult } from '../../common/types/api-response.type';

type ReelWithUser = Prisma.ReelGetPayload<{
  include: { user: { select: { id: true; username: true; displayName: true; avatarUrl: true; isVerified: true } } };
}>;

/**
 * ReelsRepository — data access layer for the Reels module.
 *
 * Encapsulates all Prisma queries so the service layer stays clean.
 * Every method accepts typed inputs and returns typed outputs.
 */
@Injectable()
export class ReelsRepository {
  constructor(public readonly db: DatabaseService) {}

  // ── Feed ──────────────────────────────────────────────────────────────────

  /**
   * Fetches a cursor-paginated feed of READY reels.
   *
   * Query is optimized for the composite index:
   *   @@index([status, createdAt(sort: Desc), id])
   *
   * Cursor-based pagination guarantees consistent results even as new reels
   * are inserted between page fetches (unlike offset pagination).
   */
  async findFeed(
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult<ReelWithUser>> {
    const take = limit + 1; // Fetch one extra to determine hasMore

    const where: Prisma.ReelWhereInput = {
      status:    ReelStatus.READY,
      isDeleted: false,
    };

    // Apply cursor: fetch reels created before the cursor reel
    if (cursor) {
      const cursorReel = await this.db.reel.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorReel) {
        where.createdAt = { lt: cursorReel.createdAt };
      }
    }

    const reels = await this.db.reel.findMany({
      where,
      take,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

    const hasMore = reels.length === take;
    const items   = hasMore ? reels.slice(0, limit) : reels;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor, hasMore };
  }

  async findUserReels(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult<ReelWithUser>> {
    const take = limit + 1;

    const where: Prisma.ReelWhereInput = {
      userId,
      status: ReelStatus.READY,
      isDeleted: false,
    };

    if (cursor) {
      const cursorReel = await this.db.reel.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorReel) {
        where.createdAt = { lt: cursorReel.createdAt };
      }
    }

    const reels = await this.db.reel.findMany({
      where,
      take,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

    const hasMore = reels.length === take;
    const items   = hasMore ? reels.slice(0, limit) : reels;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor, hasMore };
  }

  async findAllReadyIds(): Promise<string[]> {
    const reels = await this.db.reel.findMany({
      where: {
        status: ReelStatus.READY,
        isDeleted: false,
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return reels.map((r) => r.id);
  }

  async findFeedByIds(ids: string[]): Promise<ReelWithUser[]> {
    const reels = await this.db.reel.findMany({
      where: {
        id: { in: ids },
        isDeleted: false,
      },
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

    const idMap = new Map(reels.map((r) => [r.id, r]));
    return ids.map((id) => idMap.get(id)).filter((r): r is ReelWithUser => !!r);
  }

  // ── Single Reel ───────────────────────────────────────────────────────────

  async findById(id: string): Promise<ReelWithUser | null> {
    return this.db.reel.findFirst({
      where: { id, isDeleted: false },
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
  }

  async findByCloudinaryPublicId(publicId: string): Promise<Reel | null> {
    return this.db.reel.findFirst({
      where: { cloudinaryPublicId: publicId },
    });
  }

  // ── Create / Update ───────────────────────────────────────────────────────

  async create(data: {
    userId:             string;
    cloudinaryPublicId: string;
    caption?:           string;
    audioName?:         string;
    hashtags?:          string[];
  }): Promise<Reel> {
    return this.db.reel.create({ data });
  }

  async updateStatus(
    id: string,
    status: ReelStatus,
    extra?: {
      hlsUrl?:         string;
      thumbnailUrl?:   string;
      durationSeconds?: number;
    },
  ): Promise<Reel> {
    return this.db.reel.update({
      where: { id },
      data:  { status, ...extra, updatedAt: new Date() },
    });
  }

  async softDelete(id: string, userId: string): Promise<boolean> {
    const result = await this.db.reel.updateMany({
      where: { id, userId },
      data:  { isDeleted: true },
    });
    return result.count > 0;
  }

  // ── Engagement ────────────────────────────────────────────────────────────

  async isLikedBy(reelId: string, userId: string): Promise<boolean> {
    const like = await this.db.reelLike.findUnique({
      where: { reelId_userId: { reelId, userId } },
    });
    return !!like;
  }

  async toggleLike(
    reelId: string,
    userId: string,
  ): Promise<{ liked: boolean; likesCount: bigint }> {
    const existing = await this.db.reelLike.findUnique({
      where: { reelId_userId: { reelId, userId } },
    });

    if (existing) {
      // Unlike
      await this.db.$transaction([
        this.db.reelLike.delete({ where: { reelId_userId: { reelId, userId } } }),
        this.db.reel.update({
          where: { id: reelId },
          data:  { likesCount: { decrement: 1 } },
        }),
      ]);
      const reel = await this.db.reel.findUnique({ where: { id: reelId }, select: { likesCount: true } });
      return { liked: false, likesCount: reel?.likesCount ?? BigInt(0) };
    } else {
      // Like
      await this.db.$transaction([
        this.db.reelLike.create({ data: { reelId, userId } }),
        this.db.reel.update({
          where: { id: reelId },
          data:  { likesCount: { increment: 1 } },
        }),
      ]);
      const reel = await this.db.reel.findUnique({ where: { id: reelId }, select: { likesCount: true } });
      return { liked: true, likesCount: reel?.likesCount ?? BigInt(0) };
    }
  }

  async recordView(data: {
    reelId:          string;
    userId:          string;
    watchDurationMs: number;
    completed:       boolean;
    quality?:        string;
  }): Promise<void> {
    await this.db.reelView.create({ data });
  }

  // ── Batch Stats Flush (called by cron job) ────────────────────────────────

  /**
   * Atomically increments view/like counts in the DB.
   * Called by the stats flush cron job with accumulated Redis counts.
   */
  async batchIncrementViews(
    updates: Array<{ reelId: string; count: number }>,
  ): Promise<void> {
    await this.db.$transaction(
      updates.map(({ reelId, count }) =>
        this.db.reel.update({
          where: { id: reelId },
          data:  { viewsCount: { increment: count } },
        }),
      ),
    );
  }

  async addComment(
    reelId: string,
    userId: string,
    text: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const comment = await tx.reelComment.create({
        data: { reelId, userId, text },
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

      await tx.reel.update({
        where: { id: reelId },
        data: { commentsCount: { increment: 1 } },
      });

      return comment;
    });
  }

  async findComments(reelId: string) {
    return this.db.reelComment.findMany({
      where: { reelId },
      orderBy: { createdAt: 'desc' },
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
  }
}
