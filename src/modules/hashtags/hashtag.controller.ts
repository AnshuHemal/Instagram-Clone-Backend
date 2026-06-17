import { Controller, Get, Query, Param, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HashtagService } from './hashtag.service';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

@ApiTags('hashtags')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@Controller('hashtags')
export class HashtagController {
  private readonly logger = new Logger(HashtagController.name);

  constructor(private readonly hashtagService: HashtagService) {}

  // GET /api/hashtags/search?q=travel
  @Get('search')
  @SkipAuth()
  @ApiOperation({ summary: 'Search hashtags by prefix (for auto-suggest)' })
  @ApiResponse({ status: 200, description: 'Matching hashtags returned' })
  async searchHashtags(@Query('q') query: string) {
    const hashtags = await this.hashtagService.searchHashtags(query || '', 10);
    return { success: true, data: hashtags };
  }

  // GET /api/hashtags/trending
  @Get('trending')
  @SkipAuth()
  @ApiOperation({ summary: 'Get trending hashtags' })
  @ApiResponse({ status: 200, description: 'Trending hashtags returned' })
  async getTrending() {
    const hashtags = await this.hashtagService.getTrendingHashtags(10);
    return { success: true, data: hashtags };
  }

  // GET /api/hashtags/:tag
  @Get(':tag')
  @SkipAuth()
  @ApiOperation({ summary: 'Get content for a specific hashtag' })
  @ApiResponse({ status: 200, description: 'Hashtag feed returned' })
  async getHashtagFeed(
    @Param('tag') tag: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const result = await this.hashtagService.getHashtagFeed(tag, limit, cursor);
    return {
      success: true,
      data: result.items,
      meta: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        tag,
      },
    };
  }
}