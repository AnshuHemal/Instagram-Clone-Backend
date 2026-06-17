import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FeedService, FeedQueryDto, FeedType } from './feed.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

@ApiTags('feed')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@Controller('feed')
export class FeedController {
  private readonly logger = new Logger(FeedController.name);

  constructor(private readonly feedService: FeedService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/feed/explore
  // ──────────────────────────────────────────────────────────────────────────

  @Get('explore')
  @SkipAuth()
  @ApiOperation({
    summary: 'Get trending content for the Explore page',
    description:
      'Returns top-scoring posts and reels from the last 7 days, ' +
      'sorted by engagement velocity. No follow-priority boost — pure trending.',
  })
  @ApiResponse({ status: 200, description: 'Explore content returned' })
  async getExploreContent(@Query('limit') limitStr?: string) {
    const limit = limitStr ? parseInt(limitStr, 10) : 30;
    const items = await this.feedService.getExploreContent(limit);
    return {
      success: true,
      message: 'Explore content loaded',
      data: items,
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/feed/unified
  // ──────────────────────────────────────────────────────────────────────────

  @Get('unified')
  @SkipAuth()
  @ApiOperation({
    summary: 'Get a unified ranked feed (posts + reels)',
    description:
      'Returns a ranked feed combining both posts and reels.\n\n' +
      '**For You:** Scored by engagement velocity with follow-priority boost.\n' +
      '**Following:** Chronological content from people you follow.\n\n' +
      'Use `type=following` or `type=for_you` to switch modes.\n' +
      'Cached in Redis for 5 minutes.',
  })
  @ApiResponse({ status: 200, description: 'Unified feed returned' })
  async getUnifiedFeed(
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('type') type?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const feedType = (type === FeedType.FOLLOWING) ? FeedType.FOLLOWING : FeedType.FOR_YOU;
    const query: FeedQueryDto = {
      limit: limitStr ? parseInt(limitStr, 10) : 12,
      cursor,
      type: feedType,
    };

    const result = await this.feedService.getFeed(user?.sub, query);

    return {
      success: true,
      message: 'Feed loaded',
      data: result.items,
      meta: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        limit: query.limit,
        type: query.type,
      },
      timestamp: new Date().toISOString(),
    };
  }
}