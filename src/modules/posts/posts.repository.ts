import { Injectable } from '@nestjs/common';
import { Post, PostMedia, Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { PaginatedResult } from '../../common/types/api-response.type';

type PostWithDetails = Prisma.PostGetPayload<{
  include: {
    user: { select: { id: true; username: true; displayName: true; avatarUrl: true; isVerified: true } };
    media: { orderBy: { orderIndex: 'asc' } };
  };
}>;

@Injectable()
export class PostsRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Feed ──────────────────────────────────────────────────────────────────

  async findFeed(
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult<PostWithDetails>> {
    const take = limit + 1; // Fetch one extra to determine hasMore

    const where: Prisma.PostWhereInput = {
      isDeleted: false,
    };

    if (cursor) {
      const cursorPost = await this.db.post.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorPost) {
        where.createdAt = { lt: cursorPost.createdAt };
      }
    }

    const posts = await this.db.post.findMany({
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
        media: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
    });

    const hasMore = posts.length === take;
    const items   = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor, hasMore };
  }

  async findUserPosts(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult<PostWithDetails>> {
    const take = limit + 1;

    const where: Prisma.PostWhereInput = {
      userId,
      isDeleted: false,
    };

    if (cursor) {
      const cursorPost = await this.db.post.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorPost) {
        where.createdAt = { lt: cursorPost.createdAt };
      }
    }

    const posts = await this.db.post.findMany({
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
        media: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
    });

    const hasMore = posts.length === take;
    const items   = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor, hasMore };
  }

  // ── Single Post ───────────────────────────────────────────────────────────

  async findById(id: string): Promise<PostWithDetails | null> {
    return this.db.post.findFirst({
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
        media: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
    });
  }

  // ── Create / Delete ───────────────────────────────────────────────────────

  async create(data: {
    userId: string;
    caption?: string;
    location?: string;
    media: { mediaUrl: string; mediaType: string; orderIndex: number }[];
  }): Promise<PostWithDetails> {
    const post = await this.db.post.create({
      data: {
        userId: data.userId,
        caption: data.caption,
        location: data.location,
        media: {
          createMany: {
            data: data.media.map(m => ({
              mediaUrl: m.mediaUrl,
              mediaType: m.mediaType,
              orderIndex: m.orderIndex,
            })),
          },
        },
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
        media: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
    });

    return post;
  }

  async softDelete(id: string, userId: string): Promise<boolean> {
    const result = await this.db.post.updateMany({
      where: { id, userId },
      data: { isDeleted: true },
    });
    return result.count > 0;
  }

  // ── Engagement (Likes) ────────────────────────────────────────────────────

  async isLikedBy(postId: string, userId: string): Promise<boolean> {
    const like = await this.db.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    return !!like;
  }

  async toggleLike(
    postId: string,
    userId: string,
  ): Promise<{ liked: boolean; likesCount: number }> {
    const existing = await this.db.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (existing) {
      // Unlike
      await this.db.$transaction([
        this.db.postLike.delete({ where: { postId_userId: { postId, userId } } }),
        this.db.post.update({
          where: { id: postId },
          data: { likesCount: { decrement: 1 } },
        }),
      ]);
      const post = await this.db.post.findUnique({ where: { id: postId }, select: { likesCount: true } });
      return { liked: false, likesCount: post?.likesCount ?? 0 };
    } else {
      // Like
      await this.db.$transaction([
        this.db.postLike.create({ data: { postId, userId } }),
        this.db.post.update({
          where: { id: postId },
          data: { likesCount: { increment: 1 } },
        }),
      ]);
      const post = await this.db.post.findUnique({ where: { id: postId }, select: { likesCount: true } });
      return { liked: true, likesCount: post?.likesCount ?? 0 };
    }
  }

  // ── Engagement (Comments) ─────────────────────────────────────────────────

  async addComment(
    postId: string,
    userId: string,
    text: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const comment = await tx.postComment.create({
        data: { postId, userId, text },
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

      await tx.post.update({
        where: { id: postId },
        data: { commentsCount: { increment: 1 } },
      });

      return comment;
    });
  }

  async findComments(postId: string) {
    return this.db.postComment.findMany({
      where: { postId },
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

  async findAllIds(): Promise<string[]> {
    const posts = await this.db.post.findMany({
      where: {
        isDeleted: false,
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return posts.map((p) => p.id);
  }

  async findAllFollowingIds(userId: string): Promise<string[]> {
    const following = await this.db.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const followingIds = following.map((f) => f.followingId);

    // Include the user's own posts in their following timeline feed
    followingIds.push(userId);

    const posts = await this.db.post.findMany({
      where: {
        userId: { in: followingIds },
        isDeleted: false,
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return posts.map((p) => p.id);
  }

  async findFeedByIds(ids: string[]): Promise<PostWithDetails[]> {
    return this.db.post.findMany({
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
        media: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
    });
  }

  async search(query: string): Promise<PostWithDetails[]> {
    const term = query.trim();
    if (!term) return [];

    return this.db.post.findMany({
      where: {
        OR: [
          { caption: { contains: term, mode: 'insensitive' } },
          { location: { contains: term, mode: 'insensitive' } },
        ],
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
        media: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }
}
