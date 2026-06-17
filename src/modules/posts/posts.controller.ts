import {
  Controller,
  Get,
  Post,
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

  @Post('upload-signature')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a signed Cloudinary upload signature for posts',
    description: 'Returns parameters for secure direct client uploads of post media.',
  })
  @ApiResponse({ status: 200, description: 'Signed upload parameters returned' })
  getUploadSignature(
    @CurrentUser() user: JwtPayload,
    @Query('resourceType') resourceType?: 'video' | 'image',
  ) {
    const signature = this.postsService.getUploadSignature(user.sub, resourceType || 'image');
    return {
      success: true,
      message: 'Upload signature generated',
      data: signature,
      timestamp: new Date().toISOString(),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a post',
    description: 'Creates a post with media URLs uploaded directly to Cloudinary.',
  })
  @ApiResponse({ status: 201, description: 'Post created successfully' })
  async createPost(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePostDto,
  ) {
    const post = await this.postsService.createPost(user.sub, dto);
    return {
      success: true,
      message: 'Post created',
      data: post,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('feed')
  @SkipAuth()
  @ApiOperation({
    summary: 'Get timeline posts feed',
    description: 'Returns a page of posts ordered by recency. Supports cursor-based pagination.',
  })
  @ApiResponse({ status: 200, description: 'Feed page returned' })
  async getFeed(
    @Query() query: FeedQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.postsService.getFeed(user?.sub, query);
    return {
      success: true,
      message: 'Feed loaded',
      data: result.items,
      meta: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        limit: query.limit,
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('user/:userId')
  @SkipAuth()
  @ApiOperation({ summary: 'Get posts created by a specific user' })
  @ApiResponse({ status: 200, description: 'User posts returned' })
  async getUserPosts(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 12;
    return this.postsService.getUserPosts(targetUserId, limit, cursor, user?.sub);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search posts by caption or location' })
  @ApiResponse({ status: 200, description: 'Matched posts returned' })
  async searchPosts(
    @Query('q') query: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const posts = await this.postsService.searchPosts(query || '', user?.sub);
    return {
      success: true,
      message: 'Posts searched',
      data: posts,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle like status of a post' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  @ApiResponse({ status: 200, description: 'Like toggled' })
  async toggleLike(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.postsService.toggleLike(id, user.sub);
    return {
      success: true,
      message: result.liked ? 'Post liked' : 'Post unliked',
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/comment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a comment to a post' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  @ApiResponse({ status: 200, description: 'Comment added' })
  async addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body('text') text: string,
  ) {
    const comment = await this.postsService.addComment(id, user.sub, text);
    return {
      success: true,
      message: 'Comment added',
      data: comment,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id/comments')
  @SkipAuth()
  @ApiOperation({ summary: 'Get comments of a post' })
  @ApiParam({ name: 'id', description: 'Post UUID' })
  @ApiResponse({ status: 200, description: 'Comments returned' })
  async getComments(@Param('id', ParseUUIDPipe) id: string) {
    const comments = await this.postsService.getComments(id);
    return {
      success: true,
      message: 'Comments loaded',
      data: comments,
      timestamp: new Date().toISOString(),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a post (owner only)' })
  @ApiResponse({ status: 200, description: 'Post deleted' })
  async deletePost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.postsService.deletePost(id, user.sub);
    return {
      success: true,
      message: 'Post deleted',
      data: result,
      timestamp: new Date().toISOString(),
    };
  }
}
