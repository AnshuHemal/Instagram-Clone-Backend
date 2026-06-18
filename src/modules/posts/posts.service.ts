import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PostsRepository } from './posts.repository';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQueryDto, FeedType } from './dto/feed-query.dto';
import { PaginatedResult } from '../../common/types/api-response.type';
import { CacheService } from '../cache/cache.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly repo: PostsRepository,
    private readonly cloudinary: CloudinaryService,
    private readonly cache: CacheService,
    private readonly notificationsService: NotificationsService,
  ) {}

  getUploadSignature(userId: string, resourceType: 'video' | 'image' = 'image') {
    return this.cloudinary.generateUploadSignature(userId, resourceType);
  }

  async createPost(userId: string, dto: CreatePostDto) {
    const post = await this.repo.create({
      userId,
      caption: dto.caption,
      location: dto.location,
      media: dto.media.map((m, idx) => ({
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType,
        orderIndex: m.orderIndex ?? idx,
      })),
    });

    this.logger.log(`Post created [${post.id}] by user ${userId} with ${post.media.length} media files`);
    return this.formatPostResponse(post);
  }

  async updatePost(id: string, userId: string, data: { caption?: string; location?: string }) {
    const updated = await this.repo.updatePost(id, userId, data);
    if (!updated) throw new ForbiddenException('Post not found or you are not the owner');
    return this.formatPostResponse(updated);
  }

  private shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async getFeed(userId: string, query: FeedQueryDto): Promise<PaginatedResult<any>> {
    const limit = query.limit;
    const cursor = query.cursor;
    const userKey = userId || 'anonymous';
    const feedType = query.type ?? FeedType.FOR_YOU;
    const idsCacheKey = `posts:feed:${feedType}:ids:${userKey}`;

    let shuffledIds: string[] = [];

    const fetchIds = async () => {
      if (feedType === FeedType.FOLLOWING && userId) {
        return this.repo.findAllFollowingIds(userId);
      }
      return this.repo.findAllIds();
    };

    if (!cursor) {
      const allIds = await fetchIds();
      shuffledIds = this.shuffle(allIds);
      await this.cache.set(idsCacheKey, shuffledIds, 600);
    } else {
      const cachedIds = await this.cache.get<string[]>(idsCacheKey);
      if (cachedIds && cachedIds.length > 0) {
        shuffledIds = cachedIds;
      } else {
        const allIds = await fetchIds();
        shuffledIds = this.shuffle(allIds);
        await this.cache.set(idsCacheKey, shuffledIds, 600);
      }
    }

    const startIndex = cursor ? parseInt(cursor, 10) : 0;
    if (isNaN(startIndex) || startIndex >= shuffledIds.length) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const endIndex = startIndex + limit;
    const pageIds = shuffledIds.slice(startIndex, endIndex);
    const posts = await this.repo.findFeedByIds(pageIds);

    const postsMap = new Map(posts.map(p => [p.id, p]));
    const orderedPosts = pageIds.map(id => postsMap.get(id)).filter(Boolean);

    const enrichedItems = await Promise.all(
      orderedPosts.map(async (post) => {
        if (!post) return null;
        const isLiked = userId ? await this.repo.isLikedBy(post.id, userId) : false;
        const isSaved = userId ? await this.repo.isSavedBy(post.id, userId) : false;
        return { ...this.formatPostResponse(post), isLiked, isSaved };
      }),
    );

    const hasMore = endIndex < shuffledIds.length;
    return { items: enrichedItems.filter(Boolean), nextCursor: hasMore ? endIndex.toString() : null, hasMore };
  }

  async getPostById(id: string, userId?: string) {
    const post = await this.repo.findById(id);
    if (!post) throw new NotFoundException(`Post ${id} not found`);

    const isLiked = userId ? await this.repo.isLikedBy(id, userId) : false;
    const isSaved = userId ? await this.repo.isSavedBy(id, userId) : false;
    return { ...this.formatPostResponse(post), isLiked, isSaved };
  }

  async toggleLike(postId: string, userId: string) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);

    const result = await this.repo.toggleLike(postId, userId);
    if (result.liked && post.userId !== userId) {
      await this.notificationsService.createNotification(post.userId, userId, 'LIKE_POST', postId);
    }
    return result;
  }

  async toggleSave(postId: string, userId: string) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);
    return this.repo.toggleSave(postId, userId);
  }

  async getSavedPosts(userId: string, limit = 20, cursor?: string) {
    const result = await this.repo.findSavedPosts(userId, limit, cursor);
    const items = await Promise.all(
      result.items.map(async (p) => {
        const isLiked = await this.repo.isLikedBy(p.id, userId);
        return { ...this.formatPostResponse(p), isLiked, isSaved: true };
      }),
    );
    return { items, nextCursor: result.nextCursor, hasMore: result.hasMore };
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async addComment(postId: string, userId: string, text: string, parentId?: string) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);

    const comment = await this.repo.addComment(postId, userId, text, parentId);

    if (!parentId && post.userId !== userId) {
      await this.notificationsService.createNotification(post.userId, userId, 'COMMENT_POST', postId, undefined, text);
    }

    return this.formatCommentResponse(comment);
  }

  async getComments(postId: string, limit = 20, cursor?: string) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);

    const result = await this.repo.findComments(postId, limit, cursor);
    return {
      data: result.items.map(c => this.formatCommentResponse(c)),
      meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    };
  }

  async getReplies(commentId: string, limit = 10, cursor?: string) {
    const result = await this.repo.findReplies(commentId, limit, cursor);
    return {
      data: result.items.map(r => this.formatCommentResponse(r)),
      meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    };
  }

  async deleteComment(commentId: string, userId: string) {
    const deleted = await this.repo.deleteComment(commentId, userId);
    if (!deleted) throw new ForbiddenException('Comment not found or you are not the owner');
    return { deleted };
  }

  async toggleCommentLike(commentId: string, userId: string) {
    return this.repo.toggleCommentLike(commentId, userId);
  }

  async getPostLikes(postId: string, currentUserId: string, limit = 50) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);
    const data = await this.repo.findLikes(postId, currentUserId, limit);
    return { success: true, data };
  }

  async deletePost(id: string, userId: string) {
    const post = await this.repo.findById(id);
    if (!post) throw new NotFoundException(`Post ${id} not found`);
    if (post.userId !== userId) throw new ForbiddenException('Not your post');

    const deleted = await this.repo.softDelete(id, userId);
    return { deleted };
  }

  async searchPosts(query: string, userId?: string) {
    const posts = await this.repo.search(query);
    return Promise.all(
      posts.map(async (p) => {
        const isLiked = userId ? await this.repo.isLikedBy(p.id, userId) : false;
        const isSaved = userId ? await this.repo.isSavedBy(p.id, userId) : false;
        return { ...this.formatPostResponse(p), isLiked, isSaved };
      }),
    );
  }

  async getUserPosts(targetUserId: string, limit: number, cursor?: string, currentUserId?: string) {
    const result = await this.repo.findUserPosts(targetUserId, limit, cursor);
    const items = await Promise.all(
      result.items.map(async (p) => {
        const isLiked = currentUserId ? await this.repo.isLikedBy(p.id, currentUserId) : false;
        const isSaved = currentUserId ? await this.repo.isSavedBy(p.id, currentUserId) : false;
        return { ...this.formatPostResponse(p), isLiked, isSaved };
      }),
    );

    return {
      success: true,
      data: { posts: items, nextCursor: result.nextCursor, hasMore: result.hasMore },
    };
  }

  // ── Formatters ─────────────────────────────────────────────────────────────

  private formatCommentResponse(c: any) {
    return {
      id: c.id,
      text: c.text,
      parentId: c.parentId ?? null,
      likesCount: c.likesCount ?? 0,
      repliesCount: c.repliesCount ?? 0,
      isLiked: false,
      createdAt: c.createdAt,
      user: {
        id: c.user.id,
        username: c.user.username,
        displayName: c.user.displayName,
        avatarUrl: c.user.avatarUrl,
        isVerified: c.user.isVerified,
      },
    };
  }

  private formatPostResponse(post: any) {
    return {
      id: post.id,
      userId: post.userId,
      caption: post.caption,
      location: post.location,
      likesCount: post.likesCount ?? 0,
      commentsCount: post.commentsCount ?? 0,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      media: post.media.map((m: any) => ({
        id: m.id,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType,
        orderIndex: m.orderIndex,
      })),
      user: post.user ? {
        id: post.user.id,
        username: post.user.username,
        displayName: post.user.displayName,
        avatarUrl: post.user.avatarUrl,
        isVerified: post.user.isVerified,
      } : undefined,
    };
  }
}
