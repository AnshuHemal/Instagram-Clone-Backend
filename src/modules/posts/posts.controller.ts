import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

@ApiTags('posts')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  // ── Upload Signature ──────────────────────────────────────────────────────

  @Post('upload-signature')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a signed Cloudinary upload signature for posts' })
  getUploadSignature(
    @CurrentUser() user: JwtPayload,
    @Query('resourceType') resourceType?: 'video' | 'image',
  ) {
    return {
      success: true,
      message: 'Upload signature generated',
      data: this.postsService.getUploadSignature(user.sub, resourceType || 'image'),
      timestamp: new Date().toISOString(),
    };
  }

  // ── Create Post ───────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a post with media' })
  async createPost(@CurrentUser() user: JwtPayload, @Body() dto: CreatePostDto) {
    const post = await this.postsService.createPost(user.sub, dto);
    return { success: true, message: 'Post created', data: post, timestamp: new Date().toISOString() };
  }

  // ── Feed ──────────────────────────────────────────────────────────────────

  @Get('feed')
  @SkipAuth()
  @ApiOperation({ summary: 'Get timeline posts feed (cursor-based pagination)' })
  async getFeed(@Query() query: FeedQueryDto, @CurrentUser() user: JwtPayload) {
    const result = await this.postsService.getFeed(user?.sub, query);
    return {
      success: true,
      message: 'Feed loaded',
      data: result.items,
      meta: { nextCursor: result.nextCursor, hasMore: result.hasMore, limit: query.limit },
      timestamp: new Date().toISOString(),
    };
  }

  // ── Saved Posts ───────────────────────────────────────────────────────────

  @Get('saved')
  @ApiOperation({ summary: 'Get saved/bookmarked posts for current user' })
  async getSavedPosts(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const result = await this.postsService.getSavedPosts(user.sub, limit, cursor);
    return {
      success: true,
      data: result.items,
      meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
      timestamp: new Date().toISOString(),
    };
  }

  // ── User Posts ────────────────────────────────────────────────────────────

  @Get('user/:userId')
  @SkipAuth()
  @ApiOperation({ summary: 'Get posts created by a specific user' })
  async getUserPosts(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 12;
    return this.postsService.getUserPosts(targetUserId, limit, cursor, user?.sub);
  }

  // ── Search Posts ──────────────────────────────────────────────────────────

  @Get('search')
  @ApiOperation({ summary: 'Search posts by caption or location' })
  async searchPosts(@Query('q') query: string, @CurrentUser() user: JwtPayload) {
    const posts = await this.postsService.searchPosts(query || '', user?.sub);
    return { success: true, data: posts, timestamp: new Date().toISOString() };
  }

  // ── Get Post by ID ────────────────────────────────────────────────────────

  @Get(':id')
  @SkipAuth()
  @ApiOperation({ summary: 'Get a single post by ID' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  async getPost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: JwtPayload) {
    const post = await this.postsService.getPostById(id, user?.sub);
    return { success: true, data: post, timestamp: new Date().toISOString() };
  }

  // ── Update Post ───────────────────────────────────────────────────────────

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit caption/location of own post' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  async updatePost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { caption?: string; location?: string },
  ) {
    const post = await this.postsService.updatePost(id, user.sub, body);
    return { success: true, message: 'Post updated', data: post, timestamp: new Date().toISOString() };
  }

  // ── Like ──────────────────────────────────────────────────────────────────

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle like on a post' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  async toggleLike(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.postsService.toggleLike(id, user.sub);
    return { success: true, message: result.liked ? 'Post liked' : 'Post unliked', data: result, timestamp: new Date().toISOString() };
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  @Post(':id/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle save/bookmark a post' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  async toggleSave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.postsService.toggleSave(id, user.sub);
    return { success: true, message: result.saved ? 'Post saved' : 'Post unsaved', data: result, timestamp: new Date().toISOString() };
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  @Get(':id/likes')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get users who liked a post' })
  async getPostLikes(
    @CurrentUser() user: JwtPayload,
    @Param('id') postId: string,
    @Query('limit') limit?: string,
  ) {
    return this.postsService.getPostLikes(postId, user.sub, limit ? Number(limit) : 50);
  }

  @Post(':id/comment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a top-level comment to a post' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  async addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body('text') text: string,
  ) {
    const comment = await this.postsService.addComment(id, user.sub, text);
    return { success: true, message: 'Comment added', data: comment, timestamp: new Date().toISOString() };
  }

  @Get(':id/comments')
  @SkipAuth()
  @ApiOperation({ summary: 'Get paginated top-level comments of a post' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  async getComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const result = await this.postsService.getComments(id, limit, cursor);
    return { success: true, ...result, timestamp: new Date().toISOString() };
  }

  @Post(':id/comments/:commentId/reply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reply to a comment' })
  async addReply(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: JwtPayload,
    @Body('text') text: string,
  ) {
    const comment = await this.postsService.addComment(id, user.sub, text, commentId);
    return { success: true, message: 'Reply added', data: comment, timestamp: new Date().toISOString() };
  }

  @Get(':id/comments/:commentId/replies')
  @SkipAuth()
  @ApiOperation({ summary: 'Get replies to a comment' })
  async getReplies(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 10;
    const result = await this.postsService.getReplies(commentId, limit, cursor);
    return { success: true, ...result, timestamp: new Date().toISOString() };
  }

  @Post(':id/comments/:commentId/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle like on a comment' })
  async toggleCommentLike(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.postsService.toggleCommentLike(commentId, user.sub);
    return { success: true, data: result, timestamp: new Date().toISOString() };
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete own comment' })
  async deleteComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.postsService.deleteComment(commentId, user.sub);
    return { success: true, message: 'Comment deleted', data: result, timestamp: new Date().toISOString() };
  }

  // ── Delete Post ───────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a post (owner only)' })
  async deletePost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const result = await this.postsService.deletePost(id, user.sub);
    return { success: true, message: 'Post deleted', data: result, timestamp: new Date().toISOString() };
  }
}
