import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { PaginatedResult } from '../../common/types/api-response.type';

type PostWithDetails = Prisma.PostGetPayload<{
  include: {
    user: { select: { id: true; username: true; displayName: true; avatarUrl: true; isVerified: true } };
    media: { orderBy: { orderIndex: 'asc' } };
  };
}>;

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  isVerified: true,
} as const;

const POST_INCLUDE = {
  user: { select: USER_SELECT },
  media: { orderBy: { orderIndex: 'asc' as const } },
};

@Injectable()
export class PostsRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Feed ──────────────────────────────────────────────────────────────────

  async findFeed(limit: number, cursor?: string): Promise<PaginatedResult<PostWithDetails>> {
    const take = limit + 1;
    const where: Prisma.PostWhereInput = { isDeleted: false };

    if (cursor) {
      const cursorPost = await this.db.post.findUnique({ where: { id: cursor }, select: { createdAt: true } });
      if (cursorPost) where.createdAt = { lt: cursorPost.createdAt };
    }

    const posts = await this.db.post.findMany({
      where, take,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: POST_INCLUDE,
    });

    const hasMore = posts.length === take;
    const items = hasMore ? posts.slice(0, limit) : posts;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null, hasMore };
  }

  async findUserPosts(userId: string, limit: number, cursor?: string): Promise<PaginatedResult<PostWithDetails>> {
    const take = limit + 1;
    const where: Prisma.PostWhereInput = { userId, isDeleted: false };

    if (cursor) {
      const cursorPost = await this.db.post.findUnique({ where: { id: cursor }, select: { createdAt: true } });
      if (cursorPost) where.createdAt = { lt: cursorPost.createdAt };
    }

    const posts = await this.db.post.findMany({
      where, take,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: POST_INCLUDE,
    });

    const hasMore = posts.length === take;
    const items = hasMore ? posts.slice(0, limit) : posts;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null, hasMore };
  }

  async findById(id: string): Promise<PostWithDetails | null> {
    return this.db.post.findFirst({
      where: { id, isDeleted: false },
      include: POST_INCLUDE,
    });
  }

  // ── Create / Update / Delete ───────────────────────────────────────────────

  async create(data: {
    userId: string;
    caption?: string;
    location?: string;
    media: { mediaUrl: string; mediaType: string; orderIndex: number }[];
  }): Promise<PostWithDetails> {
    return this.db.post.create({
      data: {
        userId: data.userId,
        caption: data.caption,
        location: data.location,
        media: { createMany: { data: data.media } },
      },
      include: POST_INCLUDE,
    });
  }

  async updatePost(id: string, userId: string, data: { caption?: string; location?: string }): Promise<PostWithDetails | null> {
    const post = await this.db.post.findFirst({ where: { id, userId, isDeleted: false } });
    if (!post) return null;
    return this.db.post.update({
      where: { id },
      data: { caption: data.caption, location: data.location },
      include: POST_INCLUDE,
    });
  }

  async softDelete(id: string, userId: string): Promise<boolean> {
    const result = await this.db.post.updateMany({ where: { id, userId }, data: { isDeleted: true } });
    return result.count > 0;
  }

  // ── Likes ─────────────────────────────────────────────────────────────────

  async isLikedBy(postId: string, userId: string): Promise<boolean> {
    const like = await this.db.postLike.findUnique({ where: { postId_userId: { postId, userId } } });
    return !!like;
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; likesCount: number }> {
    const existing = await this.db.postLike.findUnique({ where: { postId_userId: { postId, userId } } });

    if (existing) {
      await this.db.$transaction([
        this.db.postLike.delete({ where: { postId_userId: { postId, userId } } }),
        this.db.post.update({ where: { id: postId }, data: { likesCount: { decrement: 1 } } }),
      ]);
      const post = await this.db.post.findUnique({ where: { id: postId }, select: { likesCount: true } });
      return { liked: false, likesCount: post?.likesCount ?? 0 };
    } else {
      await this.db.$transaction([
        this.db.postLike.create({ data: { postId, userId } }),
        this.db.post.update({ where: { id: postId }, data: { likesCount: { increment: 1 } } }),
      ]);
      const post = await this.db.post.findUnique({ where: { id: postId }, select: { likesCount: true } });
      return { liked: true, likesCount: post?.likesCount ?? 0 };
    }
  }

  // ── Save / Bookmark ───────────────────────────────────────────────────────

  async isSavedBy(postId: string, userId: string): Promise<boolean> {
    const saved = await this.db.savedPost.findUnique({ where: { userId_postId: { userId, postId } } });
    return !!saved;
  }

  async toggleSave(postId: string, userId: string): Promise<{ saved: boolean }> {
    const existing = await this.db.savedPost.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) {
      await this.db.savedPost.delete({ where: { userId_postId: { userId, postId } } });
      return { saved: false };
    } else {
      await this.db.savedPost.create({ data: { userId, postId } });
      return { saved: true };
    }
  }

  async findSavedPosts(userId: string, limit: number, cursor?: string): Promise<PaginatedResult<any>> {
    const take = limit + 1;
    const where: Prisma.SavedPostWhereInput = { userId };

    if (cursor) {
      const cursorSave = await this.db.savedPost.findUnique({ where: { userId_postId: { userId, postId: cursor } } });
      if (cursorSave) where.savedAt = { lt: cursorSave.savedAt };
    }

    const saved = await this.db.savedPost.findMany({
      where, take,
      orderBy: { savedAt: 'desc' },
      include: {
        post: {
          include: POST_INCLUDE,
        },
      },
    });

    const hasMore = saved.length === take;
    const items = hasMore ? saved.slice(0, limit) : saved;
    return {
      items: items.map(s => s.post).filter(Boolean),
      nextCursor: hasMore ? items[items.length - 1].postId : null,
      hasMore,
    };
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async addComment(postId: string, userId: string, text: string, parentId?: string) {
    return this.db.$transaction(async (tx) => {
      const comment = await tx.postComment.create({
        data: { postId, userId, text, parentId: parentId || null },
        include: { user: { select: USER_SELECT } },
      });
      // Only increment commentsCount for top-level comments
      if (!parentId) {
        await tx.post.update({ where: { id: postId }, data: { commentsCount: { increment: 1 } } });
      }
      return comment;
    });
  }

  async findComments(postId: string, limit = 20, cursor?: string) {
    const take = limit + 1;
    const where: Prisma.PostCommentWhereInput = { postId, parentId: null };

    if (cursor) {
      const cursorComment = await this.db.postComment.findUnique({ where: { id: cursor }, select: { createdAt: true } });
      if (cursorComment) where.createdAt = { lt: cursorComment.createdAt };
    }

    const comments = await this.db.postComment.findMany({
      where, take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: USER_SELECT },
        _count: { select: { replies: true, likes: true } },
      },
    });

    const hasMore = comments.length === take;
    const items = hasMore ? comments.slice(0, limit) : comments;
    return {
      items: items.map(c => ({
        ...c,
        repliesCount: c._count.replies,
        likesCount: c._count.likes,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
      hasMore,
    };
  }

  async findReplies(commentId: string, limit = 10, cursor?: string) {
    const take = limit + 1;
    const where: Prisma.PostCommentWhereInput = { parentId: commentId };

    if (cursor) {
      const cursorReply = await this.db.postComment.findUnique({ where: { id: cursor }, select: { createdAt: true } });
      if (cursorReply) where.createdAt = { gt: cursorReply.createdAt };
    }

    const replies = await this.db.postComment.findMany({
      where, take,
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: USER_SELECT },
        _count: { select: { likes: true } },
      },
    });

    const hasMore = replies.length === take;
    const items = hasMore ? replies.slice(0, limit) : replies;
    return {
      items: items.map(r => ({ ...r, likesCount: r._count.likes })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
      hasMore,
    };
  }

  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    const comment = await this.db.postComment.findFirst({ where: { id: commentId, userId } });
    if (!comment) return false;

    await this.db.$transaction(async (tx) => {
      await tx.postComment.deleteMany({ where: { parentId: commentId } });
      await tx.postComment.delete({ where: { id: commentId } });
      if (!comment.parentId) {
        await tx.post.update({ where: { id: comment.postId }, data: { commentsCount: { decrement: 1 } } });
      }
    });
    return true;
  }

  async toggleCommentLike(commentId: string, userId: string): Promise<{ liked: boolean; likesCount: number }> {
    const existing = await this.db.commentLike.findFirst({
      where: { userId, postCommentId: commentId },
    });

    if (existing) {
      await this.db.$transaction([
        this.db.commentLike.delete({ where: { id: existing.id } }),
        this.db.postComment.update({ where: { id: commentId }, data: { likesCount: { decrement: 1 } } }),
      ]);
    } else {
      await this.db.$transaction([
        this.db.commentLike.create({ data: { userId, postCommentId: commentId } }),
        this.db.postComment.update({ where: { id: commentId }, data: { likesCount: { increment: 1 } } }),
      ]);
    }

    const comment = await this.db.postComment.findUnique({ where: { id: commentId }, select: { likesCount: true } });
    return { liked: !existing, likesCount: comment?.likesCount ?? 0 };
  }

  // ── IDs for feed ──────────────────────────────────────────────────────────

  async findAllIds(): Promise<string[]> {
    const posts = await this.db.post.findMany({
      where: { isDeleted: false },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    return posts.map(p => p.id);
  }

  async findAllFollowingIds(userId: string): Promise<string[]> {
    const following = await this.db.follow.findMany({ where: { followerId: userId }, select: { followingId: true } });
    const followingIds = following.map(f => f.followingId);
    followingIds.push(userId);

    const posts = await this.db.post.findMany({
      where: { userId: { in: followingIds }, isDeleted: false },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    return posts.map(p => p.id);
  }

  async findFeedByIds(ids: string[]): Promise<PostWithDetails[]> {
    return this.db.post.findMany({
      where: { id: { in: ids }, isDeleted: false },
      include: POST_INCLUDE,
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
      include: POST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }
}
