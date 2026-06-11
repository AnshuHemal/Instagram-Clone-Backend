import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly db: DatabaseService) {}

  async createNotification(
    recipientId: string,
    actorId: string,
    type: NotificationType,
    postId?: string,
    reelId?: string,
    commentText?: string,
  ) {
    // Don't notify yourself
    if (recipientId === actorId) return null;

    try {
      return await this.db.notification.create({
        data: {
          recipientId,
          actorId,
          type,
          postId,
          reelId,
          commentText,
        },
      });
    } catch (error) {
      this.logger.error('Failed to create notification:', error);
      return null;
    }
  }

  async getNotifications(userId: string, cursor?: string, limit = 20) {
    const notifications = await this.db.notification.findMany({
      where: { recipientId: userId },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            isVerified: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    });

    const hasMore = notifications.length > limit;
    const data = hasMore ? notifications.slice(0, limit) : notifications;

    return {
      success: true,
      notifications: data.map(n => this.formatNotification(n)),
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.db.notification.count({
      where: {
        recipientId: userId,
        read: false,
      },
    });

    return { success: true, count };
  }

  async markAsRead(userId: string, notificationIds?: string[]) {
    const where: any = {
      recipientId: userId,
      read: false,
    };

    if (notificationIds && notificationIds.length > 0) {
      where.id = { in: notificationIds };
    }

    await this.db.notification.updateMany({
      where,
      data: { read: true },
    });

    return { success: true };
  }

  async markAllAsRead(userId: string) {
    await this.db.notification.updateMany({
      where: {
        recipientId: userId,
        read: false,
      },
      data: { read: true },
    });

    return { success: true };
  }

  async deleteNotification(userId: string, notificationId: string) {
    await this.db.notification.deleteMany({
      where: {
        id: notificationId,
        recipientId: userId,
      },
    });

    return { success: true };
  }

  private formatNotification(notification: any) {
    const { actor, ...rest } = notification;

    let message = '';
    switch (rest.type) {
      case 'FOLLOW':
        message = 'started following you.';
        break;
      case 'LIKE_POST':
        message = 'liked your post.';
        break;
      case 'LIKE_REEL':
        message = 'liked your reel.';
        break;
      case 'COMMENT_POST':
        message = `commented: "${rest.commentText?.slice(0, 50)}${rest.commentText && rest.commentText.length > 50 ? '...' : ''}"`;
        break;
      case 'COMMENT_REEL':
        message = `commented on your reel: "${rest.commentText?.slice(0, 50)}${rest.commentText && rest.commentText.length > 50 ? '...' : ''}"`;
        break;
    }

    return {
      ...rest,
      message,
      actor: {
        id: actor.id,
        username: actor.username,
        displayName: actor.displayName,
        avatarUrl: actor.avatarUrl,
        isVerified: actor.isVerified,
      },
    };
  }
}
