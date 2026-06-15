import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { NotificationType } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ─── Expo Push API ─────────────────────────────────────────────────────────────
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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
      const [notification, recipient] = await Promise.all([
        this.db.notification.create({
          data: {
            recipientId,
            actorId,
            type,
            postId,
            reelId,
            commentText,
          },
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
        }),
        this.db.user.findUnique({
          where: { id: recipientId },
          select: { pushToken: true },
        }),
      ]);

      const formatted = this.formatNotification(notification);

      // Emit Socket.IO real-time event
      this.eventEmitter.emit('notification.created', formatted);

      // Fire Expo push notification asynchronously (best-effort, non-blocking)
      if (recipient?.pushToken) {
        this.sendExpoPushNotification(
          recipient.pushToken,
          notification.actor.displayName || notification.actor.username,
          formatted.message,
          { notificationId: notification.id, type, postId, reelId },
        ).catch((err) =>
          this.logger.warn(`Expo push failed for ${recipientId}:`, err?.message),
        );
      }

      return formatted;
    } catch (error) {
      this.logger.error('Failed to create notification:', error);
      return null;
    }
  }

  // ─── Expo Push Delivery ──────────────────────────────────────────────────────

  private async sendExpoPushNotification(
    pushToken: string,
    title: string,
    body: string,
    data: Record<string, any> = {},
  ): Promise<void> {
    if (!pushToken.startsWith('ExponentPushToken[')) {
      this.logger.warn(`Skipping push — invalid token format: ${pushToken}`);
      return;
    }

    const payload = {
      to: pushToken,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId: 'default',
    };

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Expo push API error ${res.status}: ${text}`);
    }

    const json = await res.json() as any;
    const result = json?.data;

    if (result?.status === 'error') {
      this.logger.warn(
        `Expo push delivery error for token ${pushToken}: ${result.message} (${result.details?.error})`,
      );
      // If token has become invalid, clear it from DB to avoid future attempts
      if (result.details?.error === 'DeviceNotRegistered') {
        await this.db.user.updateMany({
          where: { pushToken },
          data: { pushToken: null },
        });
        this.logger.log(`Cleared invalid push token from DB: ${pushToken}`);
      }
    } else {
      this.logger.debug(`Push notification delivered (id: ${result?.id})`);
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────────

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
