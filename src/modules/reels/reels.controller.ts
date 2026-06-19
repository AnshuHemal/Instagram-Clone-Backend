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
  Sse,
  MessageEvent,
  Logger,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Observable, fromEvent, map, filter } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ReelsService } from './reels.service';
import { CreateReelDto } from './dto/create-reel.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { RecordViewDto } from './dto/record-view.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

@ApiTags('reels')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@Controller('reels')
export class ReelsController {
  private readonly logger = new Logger(ReelsController.name);

  constructor(
    private readonly reelsService: ReelsService,
    private readonly eventEmitter:  EventEmitter2,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/reels/upload-signature
  // ──────────────────────────────────────────────────────────────────────────

  @Post('upload-signature')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a signed Cloudinary upload signature',
    description:
      'Returns a short-lived signature that the mobile app uses to upload ' +
      'the raw video DIRECTLY to Cloudinary — the video never passes through ' +
      'this NestJS server. Also configures Cloudinary to begin HLS transcoding ' +
      'immediately after upload.',
  })
  @ApiResponse({ status: 200, description: 'Signed upload parameters returned' })
  getUploadSignature(@CurrentUser() user: JwtPayload) {
    const signature = this.reelsService.getUploadSignature(user.sub);
    return {
      success: true,
      message: 'Upload signature generated',
      data: signature,
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/reels
  // ──────────────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a reel record',
    description:
      'Call this AFTER the video has been uploaded to Cloudinary. ' +
      'Creates the reel record in Neon DB with status=PROCESSING. ' +
      'The reel transitions to READY when the Cloudinary webhook fires.',
  })
  @ApiResponse({ status: 201, description: 'Reel created with PROCESSING status' })
  async createReel(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReelDto,
  ) {
    const reel = await this.reelsService.createReel(user.sub, dto);
    return {
      success: true,
      message: 'Reel created — processing started',
      data: reel,
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/reels/feed
  // ──────────────────────────────────────────────────────────────────────────

  @Get('user/:userId')
  @SkipAuth()
  @ApiOperation({ summary: 'Get reels uploaded by a specific user' })
  @ApiResponse({ status: 200, description: 'User reels page returned' })
  async getUserReels(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 12;
    return this.reelsService.getUserReels(targetUserId, limit, cursor, user?.sub);
  }

  @Get('feed')
  @SkipAuth()
  @ApiOperation({
    summary: 'Get the reel feed (cursor-paginated)',
    description:
      'Returns a page of READY reels ordered by recency. ' +
      'Each reel includes the Cloudinary HLS master playlist URL (`hlsUrl`) ' +
      'for instant playback via the global CDN. ' +
      'Use `cursor` (last reel ID from previous response) for the next page. ' +
      '**Cache:** Redis 5-minute TTL.',
  })
  @ApiResponse({ status: 200, description: 'Feed page returned' })
  async getFeed(
    @Query() query: FeedQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.reelsService.getFeed(user?.sub, query);
    return {
      success: true,
      message: 'Feed loaded',
      data:    result.items,
      meta: {
        nextCursor: result.nextCursor,
        hasMore:    result.hasMore,
        limit:      query.limit,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/reels/sse/:id  — Server-Sent Events (real-time status)
  // ──────────────────────────────────────────────────────────────────────────

  @Sse('sse/:id')
  @ApiOperation({
    summary: 'SSE — Real-time reel processing status',
    description:
      'Subscribe to Server-Sent Events for a specific reel. ' +
      'Receives `reel.ready` or `reel.failed` events when Cloudinary ' +
      'finishes (or fails) HLS transcoding. ' +
      'The client can start the HLS player immediately on `reel.ready`.',
  })
  reelStatusStream(
    @Param('id', ParseUUIDPipe) id: string,
  ): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, `reel.ready`).pipe(
      map((event: any) => {
        if (event.reelId !== id) return null;
        return {
          data:  JSON.stringify(event),
          type: 'reel.ready',
          id:    id,
        } as MessageEvent;
      }),
      filter((event): event is MessageEvent => event !== null),
    );
  }

  @Get('trending-sounds')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get trending audio names from recent reels' })
  async getTrendingSounds(@Query('limit') limit?: string) {
    return this.reelsService.getTrendingSounds(Number(limit ?? 8));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/reels/:id
  // ──────────────────────────────────────────────────────────────────────────

  @Get(':id')
  @SkipAuth()
  @ApiOperation({ summary: 'Get a single reel by ID' })
  @ApiParam({ name: 'id', description: 'Reel UUID' })
  @ApiResponse({ status: 200, description: 'Reel returned' })
  @ApiResponse({ status: 404, description: 'Reel not found' })
  async getReel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const reel = await this.reelsService.getReelById(id, user?.sub);
    return {
      success: true,
      message: 'Reel loaded',
      data: reel,
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/reels/:id/like
  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle like on a reel',
    description: 'Likes the reel if not liked; unlikes if already liked.',
  })
  @ApiResponse({ status: 200, description: '{ liked: boolean, likesCount: string }' })
  async toggleLike(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.reelsService.toggleLike(id, user.sub);
    return {
      success: true,
      message: result.liked ? 'Reel liked' : 'Reel unliked',
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/reels/:id/view
  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a view event (fire-and-forget)',
    description:
      'Increments the Redis pending view counter for this reel. ' +
      'The actual DB write is deferred to the 30-second cron flush. ' +
      'Also writes to `reel_views` table for the recommendation engine.',
  })
  @ApiResponse({ status: 200, description: 'View recorded' })
  async recordView(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordViewDto,
  ) {
    const result = await this.reelsService.recordView(id, user.sub, dto);
    return {
      success: true,
      message: 'View recorded',
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE /api/reels/:id
  // ──────────────────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a reel (owner only)' })
  @ApiResponse({ status: 200, description: 'Reel deleted' })
  @ApiResponse({ status: 403, description: 'Not your reel' })
  async deleteReel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.reelsService.deleteReel(id, user.sub);
    return {
      success: true,
      message: 'Reel deleted',
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /api/reels/:id
  // ──────────────────────────────────────────────────────────────────────────

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit a reel description/audioName (owner only)' })
  @ApiResponse({ status: 200, description: 'Reel updated' })
  @ApiResponse({ status: 403, description: 'Not your reel' })
  async updateReel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body('caption') caption?: string,
    @Body('audioName') audioName?: string,
  ) {
    const result = await this.reelsService.updateReel(id, user.sub, { caption, audioName });
    return {
      success: true,
      message: 'Reel updated',
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/comment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a comment to a reel' })
  @ApiParam({ name: 'id', description: 'Reel UUID' })
  @ApiResponse({ status: 200, description: 'Comment added' })
  async addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body('text') text: string,
  ) {
    const comment = await this.reelsService.addComment(id, user.sub, text);
    return {
      success: true,
      message: 'Comment added',
      data: comment,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id/comments')
  @SkipAuth()
  @ApiOperation({ summary: 'Get comments of a reel' })
  @ApiParam({ name: 'id', description: 'Reel UUID' })
  @ApiResponse({ status: 200, description: 'Comments returned' })
  async getComments(@Param('id', ParseUUIDPipe) id: string) {
    const comments = await this.reelsService.getComments(id);
    return {
      success: true,
      message: 'Comments loaded',
      data: comments,
      timestamp: new Date().toISOString(),
    };
  }
}
