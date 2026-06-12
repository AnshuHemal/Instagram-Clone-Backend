import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  /**
   * Create a new story. Intercepts file upload and saves to Cloudinary.
   */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  async createStory(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.storiesService.createStory(user.sub, file);
  }

  /**
   * Fetch active stories list grouped by user.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getStories(@CurrentUser() user: JwtPayload) {
    return this.storiesService.getStories(user.sub);
  }

  /**
   * Log a view action for a story.
   */
  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  async viewStory(
    @CurrentUser() user: JwtPayload,
    @Param('id') storyId: string
  ) {
    return this.storiesService.viewStory(user.sub, storyId);
  }
}
