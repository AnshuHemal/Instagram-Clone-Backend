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
  async createStory(
    userId: string,
    file: Express.Multer.File,
    parentPostId?: string,
    parentPostType?: string,
  ) {
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
          parentPostId: parentPostId || null,
          parentPostType: parentPostType || null,
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
   *
   * Visibility rules (mirrors Instagram):
   *   - A user always sees their own stories.
   *   - A user sees another person's stories only when a confirmed Follow row
   *     exists (followerId = current user, followingId = story owner).
   *     • If User B accepts User A's follow request → A sees B's stories.
   *     • Only after B also follows A back will B see A's stories.
   *
   * Marks seen/unseen state based on current user's StoryViewer entries.
   */
  async getStories(userId: string) {
    const now = new Date();

    // Fetch the IDs of every user the current user is following (accepted Follow).
    const followingRows = await this.db.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const followingIds = followingRows.map((f) => f.followingId);

    // Include own stories + stories from followed users only.
    const visibleUserIds = [userId, ...followingIds];

    const activeStories = await this.db.story.findMany({
      where: {
        expiresAt: { gt: now },
        userId: { in: visibleUserIds },
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
      orderBy: { createdAt: 'asc' },
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
          isSeen: true,
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
        parentPostId: story.parentPostId || undefined,
        parentPostType: story.parentPostType || undefined,
      });
    }

    const groups = Array.from(userGroupsMap.values());

    // Sort: own stories first → unseen → seen
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
   * Get the list of users who viewed a specific story.
   * Only the story owner can see viewers.
   */
  async getStoryViewers(userId: string, storyId: string) {
    const story = await this.db.story.findUnique({
      where: { id: storyId },
      select: { userId: true },
    });
    if (!story || story.userId !== userId) {
      throw new BadRequestException('Story not found or access denied.');
    }
    const viewers = await this.db.storyViewer.findMany({
      where: { storyId },
      include: {
        viewer: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
      orderBy: { viewedAt: 'desc' },
    });
    return {
      success: true,
      data: viewers.map(v => ({
        ...v.viewer,
        viewedAt: v.viewedAt,
      })),
      count: viewers.length,
    };
  }

  /**
   * Delete a story (only the owner can delete their own story).
   */
  async deleteStory(userId: string, storyId: string) {
    const story = await this.db.story.findUnique({
      where: { id: storyId },
      select: { userId: true, mediaUrl: true },
    });
    if (!story || story.userId !== userId) {
      throw new BadRequestException('Story not found or access denied.');
    }
    // Delete from Cloudinary
    const parsed = this.getCloudinaryPublicId(story.mediaUrl);
    if (parsed) {
      try {
        await cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType as any });
      } catch (_) {}
    }
    await this.db.story.delete({ where: { id: storyId } });
    return { success: true, message: 'Story deleted.' };
  }

  /**
   * Fetch all of a user's own stories (active + expired) for the archive/highlight picker.
   * Returns stories in reverse chronological order (newest first).
   */
  async getStoryArchive(userId: string) {
    return this.db.story.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        mediaUrl: true,
        mediaType: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }

  /**
   * Hourly Cron Job: Cleans up expired stories that are NOT part of any Highlight.
   * Stories added to a Highlight are preserved until the Highlight is deleted.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredStoriesCleanup() {
    this.logger.log('⏳ Running expired stories hourly cleanup cron task...');
    const now = new Date();

    // Only delete expired stories that are not referenced by any highlight
    const expiredStories = await this.db.story.findMany({
      where: {
        expiresAt: { lt: now },
        highlights: {
          none: {}, // Skip stories that belong to at least one highlight
        },
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

    const deleteResult = await this.db.story.deleteMany({
      where: {
        id: { in: expiredStories.map((s) => s.id) },
      },
    });

    this.logger.log(`🗑️ Successfully deleted ${deleteResult.count} expired stories from PostgreSQL.`);
  }

  // ── Highlights ─────────────────────────────────────────────────────────────

  async createHighlight(userId: string, title: string, coverUrl?: string, storyIds?: string[]) {
    const highlight = await this.db.highlight.create({
      data: {
        userId,
        title,
        coverUrl,
        ...(storyIds && storyIds.length > 0
          ? {
              stories: {
                createMany: {
                  data: storyIds.map((storyId, i) => ({ storyId, orderIndex: i })),
                  skipDuplicates: true,
                },
              },
            }
          : {}),
      },
      include: {
        stories: {
          include: { story: { select: { id: true, mediaUrl: true, mediaType: true, createdAt: true } } },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    return { success: true, data: highlight };
  }

  async getHighlights(userId: string) {
    const highlights = await this.db.highlight.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        stories: {
          include: { story: { select: { id: true, mediaUrl: true, mediaType: true, createdAt: true } } },
          orderBy: { orderIndex: 'asc' },
          take: 1,
        },
        _count: { select: { stories: true } },
      },
    });
    return {
      success: true,
      data: highlights.map(h => ({
        id: h.id,
        title: h.title,
        coverUrl: h.coverUrl || h.stories[0]?.story?.mediaUrl,
        storiesCount: h._count.stories,
        createdAt: h.createdAt,
      })),
    };
  }

  async getHighlightStories(highlightId: string) {
    const stories = await this.db.highlightStory.findMany({
      where: { highlightId },
      orderBy: { orderIndex: 'asc' },
      include: {
        story: {
          select: { id: true, mediaUrl: true, mediaType: true, createdAt: true, userId: true },
        },
      },
    });
    return { success: true, data: stories.map(hs => hs.story) };
  }

  async addStoryToHighlight(highlightId: string, storyId: string, userId: string) {
    const highlight = await this.db.highlight.findFirst({ where: { id: highlightId, userId } });
    if (!highlight) throw new BadRequestException('Highlight not found or access denied.');

    const maxOrder = await this.db.highlightStory.aggregate({
      where: { highlightId },
      _max: { orderIndex: true },
    });
    const nextOrder = (maxOrder._max.orderIndex ?? -1) + 1;

    await this.db.highlightStory.upsert({
      where: { highlightId_storyId: { highlightId, storyId } },
      update: {},
      create: { highlightId, storyId, orderIndex: nextOrder },
    });
    return { success: true, message: 'Story added to highlight.' };
  }

  async removeStoryFromHighlight(highlightId: string, storyId: string, userId: string) {
    const highlight = await this.db.highlight.findFirst({ where: { id: highlightId, userId } });
    if (!highlight) throw new BadRequestException('Highlight not found or access denied.');

    await this.db.highlightStory.deleteMany({ where: { highlightId, storyId } });
    return { success: true, message: 'Story removed from highlight.' };
  }

  async updateHighlight(highlightId: string, userId: string, data: { title?: string; coverUrl?: string }) {
    const highlight = await this.db.highlight.findFirst({ where: { id: highlightId, userId } });
    if (!highlight) throw new BadRequestException('Highlight not found or access denied.');

    const updated = await this.db.highlight.update({
      where: { id: highlightId },
      data: { title: data.title, coverUrl: data.coverUrl },
    });
    return { success: true, data: updated };
  }

  async deleteHighlight(highlightId: string, userId: string) {
    const highlight = await this.db.highlight.findFirst({ where: { id: highlightId, userId } });
    if (!highlight) throw new BadRequestException('Highlight not found or access denied.');

    await this.db.highlight.delete({ where: { id: highlightId } });
    return { success: true, message: 'Highlight deleted.' };
  }
}

