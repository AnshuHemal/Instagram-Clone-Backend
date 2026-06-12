import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Helper to parse Cloudinary public_id and resource_type from URL
   */
  private getCloudinaryPublicId(url: string): { publicId: string; resourceType: string } | null {
    if (!url || !url.includes('cloudinary.com')) return null;
    try {
      const parts = url.split('/upload/');
      if (parts.length < 2) return null;

      let path = parts[1];
      // Remove version (e.g. v1234567/)
      path = path.replace(/^v\d+\//, '');

      const lastDotIndex = path.lastIndexOf('.');
      if (lastDotIndex !== -1) {
        path = path.substring(0, lastDotIndex);
      }

      const resourceType = url.includes('/video/') ? 'video' : 'image';
      return { publicId: path, resourceType };
    } catch (e) {
      return null;
    }
  }

  /**
   * Upload a story media buffer to Cloudinary and create a Story record.
   * Stories expire in exactly 24 hours.
   */
  async createStory(userId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const isVideo = file.mimetype.startsWith('video/');
    const resourceType = isVideo ? 'video' : 'image';

    try {
      const uploadResult = await new Promise<any>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'stories',
            resource_type: resourceType,
            // If video, limit duration to 15 seconds. If image, optimize quality.
            ...(isVideo
              ? { transformation: [{ duration: 15, crop: 'limit' }] }
              : { transformation: [{ quality: 'auto:good' }] }),
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(file.buffer);
      });

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      return this.db.story.create({
        data: {
          userId,
          mediaUrl: uploadResult.secure_url,
          mediaType: isVideo ? 'VIDEO' : 'IMAGE',
          expiresAt,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      });
    } catch (err) {
      this.logger.error('Story upload to Cloudinary failed:', err);
      throw new BadRequestException('Story upload failed. Please try again.');
    }
  }

  /**
   * Fetch active stories grouped by User.
   * Marks seen/unseen state based on current user's StoryViewer entries.
   */
  async getStories(userId: string) {
    const now = new Date();

    const activeStories = await this.db.story.findMany({
      where: {
        expiresAt: { gt: now },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        viewers: {
          where: { viewerId: userId },
        },
      },
      orderBy: { createdAt: 'asc' }, // Order oldest first so users view sequentially
    });

    const userGroupsMap = new Map<string, any>();

    for (const story of activeStories) {
      const u = story.user;
      const wasViewed = story.viewers.length > 0;

      if (!userGroupsMap.has(u.id)) {
        userGroupsMap.set(u.id, {
          userId: u.id,
          username: u.username,
          displayName: u.displayName || u.username,
          avatar: u.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
          isSeen: true, // Defaults to seen, will flip to false if any active story is unseen
          stories: [],
        });
      }

      const group = userGroupsMap.get(u.id)!;
      if (!wasViewed) {
        group.isSeen = false;
      }

      group.stories.push({
        id: story.id,
        mediaUrl: story.mediaUrl,
        mediaType: story.mediaType,
        createdAt: story.createdAt,
        isSeen: wasViewed,
      });
    }

    const groups = Array.from(userGroupsMap.values());

    // Sort: current user first, then unseen groups, then seen groups
    return groups.sort((a, b) => {
      if (a.userId === userId) return -1;
      if (b.userId === userId) return 1;
      if (a.isSeen === b.isSeen) return 0;
      return a.isSeen ? 1 : -1;
    });
  }

  /**
   * Mark a specific story as viewed by the user.
   */
  async viewStory(userId: string, storyId: string) {
    // Check if story exists and is active
    const story = await this.db.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new BadRequestException('Story not found.');
    }

    return this.db.storyViewer.upsert({
      where: {
        storyId_viewerId: { storyId, viewerId: userId },
      },
      update: {},
      create: {
        storyId,
        viewerId: userId,
      },
    });
  }

  /**
   * Hourly Cron Job: Cleans up expired stories.
   * Deletes database logs and requests Cloudinary to remove media assets.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredStoriesCleanup() {
    this.logger.log('⏳ Running expired stories hourly cleanup cron task...');
    const now = new Date();

    const expiredStories = await this.db.story.findMany({
      where: {
        expiresAt: { lt: now },
      },
      select: {
        id: true,
        mediaUrl: true,
      },
    });

    if (expiredStories.length === 0) {
      this.logger.log('✅ No expired stories to clean up.');
      return;
    }

    this.logger.log(`Cleaning up ${expiredStories.length} expired stories...`);

    for (const story of expiredStories) {
      const parsed = this.getCloudinaryPublicId(story.mediaUrl);
      if (parsed) {
        try {
          await cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType });
          this.logger.log(`Deleted expired Cloudinary asset: ${parsed.publicId}`);
        } catch (err) {
          this.logger.error(`Failed to delete expired asset ${parsed.publicId}:`, err);
        }
      }
    }

    // Delete records from database
    const deleteResult = await this.db.story.deleteMany({
      where: {
        id: { in: expiredStories.map((s) => s.id) },
      },
    });

    this.logger.log(`🗑️ Successfully deleted ${deleteResult.count} expired stories from PostgreSQL.`);
  }
}
