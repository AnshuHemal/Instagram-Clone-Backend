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
          groupName: conv.groupName,
          groupAvatar: conv.groupAvatar,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          partner: conv.isGroup ? null : partnerWithPresence,
          participants: conv.participants.map(p => ({
            id: p.user.id,
            username: p.user.username,
            displayName: p.user.displayName,
            avatarUrl: p.user.avatarUrl,
            isAdmin: p.isAdmin,
          })),
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
        story: {
          select: {
            id: true,
            mediaUrl: true,
            mediaType: true,
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              }
            }
          }
        }
      },
    });

    let nextCursor: string | undefined = undefined;
    if (messages.length > limit) {
      const nextItem = messages.pop();
      nextCursor = nextItem?.id;
    }

    // Resolve post and reel references if any exist
    const postIds = messages.filter(m => m.referenceType === 'post' && m.referenceId).map(m => m.referenceId as string);
    const reelIds = messages.filter(m => m.referenceType === 'reel' && m.referenceId).map(m => m.referenceId as string);

    const [posts, reels] = await Promise.all([
      postIds.length > 0 ? this.db.post.findMany({
        where: { id: { in: postIds } },
        include: {
          media: { select: { mediaUrl: true, mediaType: true }, take: 1 },
          user: { select: { id: true, username: true, avatarUrl: true } }
        }
      }) : [],
      reelIds.length > 0 ? this.db.reel.findMany({
        where: { id: { in: reelIds } },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } }
        }
      }) : []
    ]);

    const postsMap = new Map<string, any>(posts.map(p => [p.id, p] as [string, any]));
    const reelsMap = new Map<string, any>(reels.map(r => [r.id, r] as [string, any]));

    const messagesWithReferences = messages.map(msg => {
      let reference: any = null;
      if (msg.referenceType === 'post' && msg.referenceId) {
        reference = postsMap.get(msg.referenceId) || null;
      } else if (msg.referenceType === 'reel' && msg.referenceId) {
        reference = reelsMap.get(msg.referenceId) || null;
      } else if (msg.referenceType === 'story' && msg.story) {
        reference = msg.story;
      }
      return {
        ...msg,
        reference
      };
    });

    return {
      messages: messagesWithReferences,
      nextCursor,
    };
  }

  /**
   * Saves a message to the database.
   */
  async saveMessage(
    conversationId: string,
    senderId: string,
    text: string,
    mediaUrl?: string,
    referenceType?: string,
    referenceId?: string,
    storyId?: string
  ) {
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
        referenceType,
        referenceId,
        storyId,
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
        story: {
          select: {
            id: true,
            mediaUrl: true,
            mediaType: true,
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              }
            }
          }
        }
      },
    });

    // Update conversation updatedAt timestamp
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Resolve reference
    let reference: any = null;
    if (message.referenceType === 'post' && message.referenceId) {
      reference = await this.db.post.findUnique({
        where: { id: message.referenceId },
        include: {
          media: { select: { mediaUrl: true, mediaType: true }, take: 1 },
          user: { select: { id: true, username: true, avatarUrl: true } }
        }
      });
    } else if (message.referenceType === 'reel' && message.referenceId) {
      reference = await this.db.reel.findUnique({
        where: { id: message.referenceId },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } }
        }
      });
    } else if (message.referenceType === 'story' && message.story) {
      reference = message.story;
    }

    return {
      ...message,
      reference,
    };
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

    const partner = conv.isGroup ? null : (conv.participants.find((p) => p.userId !== userId)?.user || null);
    const partnerWithPresence = partner ? {
      ...partner,
      isOnline: this.presenceService.isOnline(partner.id),
    } : null;

    return {
      id: conv.id,
      isGroup: conv.isGroup,
      groupName: conv.groupName,
      groupAvatar: conv.groupAvatar,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      partner: partnerWithPresence,
      participants: conv.participants.map(p => ({
        id: p.user.id,
        username: p.user.username,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        isAdmin: p.isAdmin,
      })),
    };
  }

  /**
   * Creates a new group conversation with multiple participants.
   */
  async createGroupConversation(creatorId: string, name: string, participantIds: string[], groupAvatar?: string) {
    if (!name || name.trim() === '') {
      throw new BadRequestException('Group name is required.');
    }
    if (!participantIds || participantIds.length === 0) {
      throw new BadRequestException('At least one participant is required.');
    }

    // Verify all participants exist
    const users = await this.db.user.findMany({
      where: {
        id: { in: [...participantIds, creatorId] },
      },
    });

    const userIds = users.map((u) => u.id);
    const allParticipants = Array.from(new Set([...participantIds, creatorId]));

    const missing = allParticipants.filter((id) => !userIds.includes(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Users not found: ${missing.join(', ')}`);
    }

    return this.db.conversation.create({
      data: {
        isGroup: true,
        groupName: name,
        groupAvatar: groupAvatar || null,
        participants: {
          create: allParticipants.map((id) => ({
            userId: id,
            isAdmin: id === creatorId,
          })),
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
   * Updates group metadata (name, avatar).
   */
  async updateGroupDetails(conversationId: string, userId: string, name?: string, groupAvatar?: string) {
    const conv = await this.db.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });
    if (!conv) {
      throw new BadRequestException('Group conversation not found.');
    }
    if (!conv.isGroup) {
      throw new BadRequestException('This conversation is not a group.');
    }

    // Verify user is a participant
    const isMember = conv.participants.some((p) => p.userId === userId);
    if (!isMember) {
      throw new BadRequestException('You are not a participant in this group.');
    }

    const data: any = {};
    if (name !== undefined) data.groupName = name;
    if (groupAvatar !== undefined) data.groupAvatar = groupAvatar;

    return this.db.conversation.update({
      where: { id: conversationId },
      data,
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
   * Adds participants to an existing group.
   */
  async addGroupParticipants(conversationId: string, userId: string, participantIds: string[]) {
    const conv = await this.db.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });
    if (!conv) {
      throw new BadRequestException('Group conversation not found.');
    }
    if (!conv.isGroup) {
      throw new BadRequestException('This conversation is not a group.');
    }

    // Verify user is a participant
    const isMember = conv.participants.some((p) => p.userId === userId);
    if (!isMember) {
      throw new BadRequestException('You are not a participant in this group.');
    }

    const existingIds = conv.participants.map((p) => p.userId);
    const newIds = participantIds.filter((id) => !existingIds.includes(id));

    if (newIds.length === 0) {
      return this.getConversationById(conversationId, userId);
    }

    // Verify user IDs exist
    const users = await this.db.user.findMany({
      where: { id: { in: newIds } },
    });
    if (users.length !== newIds.length) {
      throw new BadRequestException('Some users were not found.');
    }

    // Create participants
    await this.db.conversationParticipant.createMany({
      data: newIds.map((id) => ({
        conversationId,
        userId: id,
        isAdmin: false,
      })),
    });

    return this.getConversationById(conversationId, userId);
  }

  /**
   * Removes a participant from a group.
   */
  async removeGroupParticipant(conversationId: string, userId: string, targetUserId: string) {
    const conv = await this.db.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });
    if (!conv) {
      throw new BadRequestException('Group conversation not found.');
    }
    if (!conv.isGroup) {
      throw new BadRequestException('This conversation is not a group.');
    }

    const targetParticipant = conv.participants.find((p) => p.userId === targetUserId);
    if (!targetParticipant) {
      throw new BadRequestException('Target user is not a participant in this group.');
    }

    const isSelf = userId === targetUserId;
    const isUserAdmin = conv.participants.find((p) => p.userId === userId)?.isAdmin || false;

    if (!isSelf && !isUserAdmin) {
      throw new BadRequestException('You must be a group admin to remove other participants.');
    }

    await this.db.conversationParticipant.delete({
      where: {
        conversationId_userId: {
          conversationId,
          userId: targetUserId,
        },
      },
    });

    return { success: true };
  }
}
