import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PostsRepository } from './posts.repository';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { PaginatedResult } from '../../common/types/api-response.type';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly repo: PostsRepository,
    private readonly cloudinary: CloudinaryService,
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

  async getFeed(userId: string, query: FeedQueryDto): Promise<PaginatedResult<any>> {
    const feed = await this.repo.findFeed(query.limit, query.cursor);
    const enrichedItems = await Promise.all(
      feed.items.map(async (post) => {
        const isLiked = userId ? await this.repo.isLikedBy(post.id, userId) : false;
        return {
          ...this.formatPostResponse(post),
          isLiked,
        };
      }),
    );

    return {
      items: enrichedItems,
      nextCursor: feed.nextCursor,
      hasMore: feed.hasMore,
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
    return result;
  }

  async addComment(postId: string, userId: string, text: string) {
    const post = await this.repo.findById(postId);
    if (!post) throw new NotFoundException(`Post ${postId} not found`);

    const comment = await this.repo.addComment(postId, userId, text);
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
