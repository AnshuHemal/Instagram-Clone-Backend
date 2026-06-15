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

  getUploadSignature(userId: string) {
    return this.cloudinary.generateUploadSignature(userId);
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
      this.logger.debug(`Generating new randomized posts feed [${feedType}] for user: ${userKey}`);
      const allIds = await fetchIds();
      shuffledIds = this.shuffle(allIds);
      await this.cache.set(idsCacheKey, shuffledIds, 600); // 10 minutes TTL
    } else {
      this.logger.debug(`Retrieving cached randomized posts feed [${feedType}] for user: ${userKey}, cursor: ${cursor}`);
      const cachedIds = await this.cache.get<string[]>(idsCacheKey);
      if (cachedIds && cachedIds.length > 0) {
        shuffledIds = cachedIds;
      } else {
        this.logger.warn(`Randomized posts feed cache miss for user ${userKey} during paging. Regenerating feed.`);
        const allIds = await fetchIds();
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
    const posts = await this.repo.findFeedByIds(pageIds);

    // Map database results to preserve the shuffled pageIds ordering
    const postsMap = new Map(posts.map((p) => [p.id, p]));
    const orderedPosts = pageIds.map((id) => postsMap.get(id)).filter(Boolean);

    const enrichedItems = await Promise.all(
      orderedPosts.map(async (post) => {
        if (!post) throw new Error('Post not found in feed');
        const isLiked = userId ? await this.repo.isLikedBy(post.id, userId) : false;
        return {
          ...this.formatPostResponse(post),
          isLiked,
        };
      }),
    );

    const hasMore = endIndex < shuffledIds.length;
    const nextCursor = hasMore ? endIndex.toString() : null;

    return {
      items: enrichedItems,
      nextCursor,
      hasMore,
    };
  }

  async getPostById(id: string, userId?: string) {
    const post = await this.repo.findById(id);
    if (!post) throw new NotFoundException(`Post ${id} not found`);

    const isLiked = userId ? await this.repo.isLikedBy(id, userId) : false;
    return {
      ...this.formatPostResponse(post),
      isLiked,
    };
  }

  async toggleLike(postId: string, userId: string) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);

    const result = await this.repo.toggleLike(postId, userId);

    // Create like notification if post was liked (not unliked)
    if (result.liked) {
      await this.notificationsService.createNotification(
        post.userId,
        userId,
        'LIKE_POST',
        postId,
      );
    }

    return result;
  }

  async addComment(postId: string, userId: string, text: string) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);

    const comment = await this.repo.addComment(postId, userId, text);

    // Create comment notification
    await this.notificationsService.createNotification(
      post.userId,
      userId,
      'COMMENT_POST',
      postId,
      undefined,
      text,
    );

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

  async getComments(postId: string) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);

    const comments = await this.repo.findComments(postId);
    return comments.map(c => ({
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

  async deletePost(id: string, userId: string) {
    const post = await this.repo.findById(id);
    if (!post) throw new NotFoundException(`Post ${id} not found`);
    if (post.userId !== userId) throw new ForbiddenException('Not your post');

    const deleted = await this.repo.softDelete(id, userId);
    return { deleted };
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
