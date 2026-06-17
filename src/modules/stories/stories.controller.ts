import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('stories')
@Controller('stories')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  // ── Stories ────────────────────────────────────────────────────────────────

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new story' })
  async createStory(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.storiesService.createStory(user.sub, file);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get active stories grouped by user' })
  async getStories(@CurrentUser() user: JwtPayload) {
    return this.storiesService.getStories(user.sub);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a story as viewed' })
  async viewStory(@CurrentUser() user: JwtPayload, @Param('id') storyId: string) {
    return this.storiesService.viewStory(user.sub, storyId);
  }

  @Get('archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all stories ever created by current user (archive)' })
  async getStoryArchive(@CurrentUser() user: JwtPayload) {
    return this.storiesService.getStoryArchive(user.sub);
  }

  // ── Highlights ─────────────────────────────────────────────────────────────

  @Post('highlights')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new highlight collection' })
  async createHighlight(
    @CurrentUser() user: JwtPayload,
    @Body() body: { title: string; coverUrl?: string; storyIds?: string[] },
  ) {
    return this.storiesService.createHighlight(user.sub, body.title, body.coverUrl, body.storyIds);
  }

  @Get('highlights/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get highlights for a user' })
  async getHighlights(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.storiesService.getHighlights(userId);
  }

  @Get('highlights/:id/stories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get stories in a highlight' })
  async getHighlightStories(@Param('id', ParseUUIDPipe) id: string) {
    return this.storiesService.getHighlightStories(id);
  }

  @Post('highlights/:id/stories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a story to a highlight' })
  async addStoryToHighlight(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) highlightId: string,
    @Body('storyId', ParseUUIDPipe) storyId: string,
  ) {
    return this.storiesService.addStoryToHighlight(highlightId, storyId, user.sub);
  }

  @Delete('highlights/:id/stories/:storyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a story from a highlight' })
  async removeStoryFromHighlight(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) highlightId: string,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    return this.storiesService.removeStoryFromHighlight(highlightId, storyId, user.sub);
  }

  @Patch('highlights/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update highlight title/cover' })
  async updateHighlight(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) highlightId: string,
    @Body() body: { title?: string; coverUrl?: string },
  ) {
    return this.storiesService.updateHighlight(highlightId, user.sub, body);
  }

  @Delete('highlights/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a highlight' })
  async deleteHighlight(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) highlightId: string,
  ) {
    return this.storiesService.deleteHighlight(highlightId, user.sub);
  }
}
