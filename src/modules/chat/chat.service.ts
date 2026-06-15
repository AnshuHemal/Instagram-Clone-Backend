import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ChatPresenceService } from './chat-presence.service';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly presenceService: ChatPresenceService,
  ) {}

  /**
   * Marks all unread messages in a conversation sent by the other user as read.
   */
  async markConversationMessagesAsRead(conversationId: string, userId: string) {
    const result = await this.db.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    return { success: true, count: result.count };
  }

  /**
   * Uploads file buffer to Cloudinary (image or video) for chat media.
   */
  async uploadChatMedia(userId: string, file: any) {
    try {
      const uploadResult = await new Promise<any>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'chat_media',
            resource_type: 'auto',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(file.buffer);
      });

      return {
        secure_url: uploadResult.secure_url,
        resource_type: uploadResult.resource_type,
      };
    } catch (err) {
      throw new BadRequestException(`Media upload failed: ${err.message}`);
    }
  }

  /**
   * Finds an existing 1-to-1 conversation between two users, or creates a new one.
   */
  async getOrCreateConversation(userId: string, partnerId: string) {
    if (userId === partnerId) {
      throw new BadRequestException('You cannot start a conversation with yourself.');
    }

    // Check if partner user exists
    const partner = await this.db.user.findUnique({
      where: { id: partnerId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });
    if (!partner) {
      throw new BadRequestException('Partner user not found.');
    }

    // Find if there is an existing 1-to-1 conversation containing both participants
    const existingConversation = await this.db.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: partnerId } } },
        ],
      },
      include: {
        participants: {
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
        },
      },
    });

    if (existingConversation) {
      return existingConversation;
    }

    // Create a new 1-to-1 conversation
    return this.db.conversation.create({
      data: {
        isGroup: false,
        participants: {
          create: [
            { userId },
            { userId: partnerId },
          ],
        },
      },
      include: {
        participants: {
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
        },
      },
    });
  }

  /**
   * Retrieves all conversations the user is participating in.
   * Maps partner details and includes last message preview.
   */
  async getConversations(userId: string) {
    const participations = await this.db.conversationParticipant.findMany({
      where: { userId },
      select: {
        conversationId: true,
      },
    });

    const conversationIds = participations.map((p) => p.conversationId);

    const conversations = await this.db.conversation.findMany({
      where: {
        id: { in: conversationIds },
      },
      include: {
        participants: {
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
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Format for client consumption with unread count
    const conversationList = await Promise.all(
      conversations.map(async (conv) => {
        // Extract partner details (the participant that is NOT the user)
        const partner = conv.participants.find((p) => p.userId !== userId)?.user || null;
        const lastMessage = conv.messages[0] || null;

        const partnerWithPresence = partner ? {
          ...partner,
          isOnline: this.presenceService.isOnline(partner.id),
        } : null;

        // Query the actual unread messages count
        const unreadCount = await this.db.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: userId },
            isRead: false,
          },
        });

        return {
          id: conv.id,
          isGroup: conv.isGroup,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          partner: partnerWithPresence,
          lastMessage: lastMessage ? lastMessage.text : '',
          lastMessageTime: lastMessage ? lastMessage.createdAt : conv.updatedAt,
          lastMessageSenderId: lastMessage ? lastMessage.senderId : null,
          unreadCount,
        };
      })
    );

    return conversationList.sort((a, b) => {
      const timeA = new Date(a.lastMessageTime).getTime();
      const timeB = new Date(b.lastMessageTime).getTime();
      return timeB - timeA; // sort newest first
    });
  }

  /**
   * Paginated fetch of message history in a conversation using cursor.
   */
  async getMessages(conversationId: string, limit: number, cursor?: string) {
    const messages = await this.db.message.findMany({
      where: { conversationId },
      take: limit + 1, // Fetch one extra to determine if nextCursor exists
      orderBy: { createdAt: 'desc' },
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor },
      }),
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    let nextCursor: string | undefined = undefined;
    if (messages.length > limit) {
      const nextItem = messages.pop();
      nextCursor = nextItem?.id;
    }

    return {
      messages, // Newer messages first (desc order)
      nextCursor,
    };
  }

  /**
   * Saves a message to the database.
   */
  async saveMessage(conversationId: string, senderId: string, text: string, mediaUrl?: string) {
    // Check if conversation exists
    const conv = await this.db.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) {
      throw new BadRequestException('Conversation not found.');
    }

    const message = await this.db.message.create({
      data: {
        conversationId,
        senderId,
        text,
        mediaUrl,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Update conversation updatedAt timestamp
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  /**
   * Retrieves a single conversation by its ID.
   */
  async getConversationById(conversationId: string, userId: string) {
    const conv = await this.db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
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
        },
      },
    });

    if (!conv) {
      throw new BadRequestException('Conversation not found.');
    }

    const partner = conv.participants.find((p) => p.userId !== userId)?.user || null;
    const partnerWithPresence = partner ? {
      ...partner,
      isOnline: this.presenceService.isOnline(partner.id),
    } : null;

    return {
      id: conv.id,
      isGroup: conv.isGroup,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      partner: partnerWithPresence,
    };
  }
}
