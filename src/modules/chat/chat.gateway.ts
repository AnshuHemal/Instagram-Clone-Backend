import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { ChatService } from './chat.service';
import { ChatPresenceService } from './chat-presence.service';
import { DatabaseService } from '../database/database.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  pingInterval: 10000,
  pingTimeout: 5000,
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
    private readonly presenceService: ChatPresenceService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Handle incoming WebSocket client connections.
   * Performs authentication using JWT.
   */
  async handleConnection(socket: Socket) {
    try {
      let token = socket.handshake.headers['authorization'] as string;
      if (!token) {
        token = socket.handshake.query['token'] as string;
      }
      if (token && token.startsWith('Bearer ')) {
        token = token.substring(7);
      }

      if (!token) {
        this.logger.warn(`Connection attempt without token: ${socket.id}`);
        socket.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const userId = payload.sub;

      // Attach userId to socket session data
      socket.data.userId = userId;

      // Register presence
      this.presenceService.add(userId);

      // Join user to their own personal room (useful for direct notifications)
      socket.join(`user:${userId}`);

      // Broadcast user online event to other active socket clients
      socket.broadcast.emit('userOnlineStatus', { userId, isOnline: true });

      this.logger.log(`User connected: ${userId} (${socket.id})`);
    } catch (err) {
      this.logger.warn(`Authentication failed on socket connection ${socket.id}: ${err.message}`);
      socket.disconnect();
    }
  }

  /**
   * Handle socket client disconnections.
   */
  handleDisconnect(socket: Socket) {
    const userId = socket.data.userId;
    if (userId) {
      this.presenceService.remove(userId);
      socket.broadcast.emit('userOnlineStatus', { userId, isOnline: false });
      this.logger.log(`User disconnected: ${userId} (${socket.id})`);
    }
  }

  /**
   * Room Strategy: join conversation channel room.
   */
  @SubscribeMessage('joinConversation')
  handleJoinConversation(
    @ConnectedSocket() socket: Socket,
    @MessageBody('conversationId') conversationId: string,
  ) {
    socket.join(conversationId);
    this.logger.log(`Socket ${socket.id} joined conversation room: ${conversationId}`);
    return { success: true };
  }

  /**
   * Leave conversation channel room.
   */
  @SubscribeMessage('leaveConversation')
  handleLeaveConversation(
    @ConnectedSocket() socket: Socket,
    @MessageBody('conversationId') conversationId: string,
  ) {
    socket.leave(conversationId);
    this.logger.log(`Socket ${socket.id} left conversation room: ${conversationId}`);
    return { success: true };
  }

  /**
   * Real-time message event: saves message in Neon DB and broadcasts to conversation room.
   */
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { 
      conversationId: string; 
      text: string; 
      mediaUrl?: string;
      referenceType?: string;
      referenceId?: string;
      storyId?: string;
    },
  ) {
    const senderId = socket.data.userId;
    if (!senderId) {
      socket.disconnect();
      return;
    }

    try {
      // Persist to Neon DB
      const message = await this.chatService.saveMessage(
        data.conversationId,
        senderId,
        data.text,
        data.mediaUrl,
        data.referenceType,
        data.referenceId,
        data.storyId,
      );

      // Broadcast the persisted message to the room (including sender)
      this.server.to(data.conversationId).emit('messageReceived', message);

      // Also trigger a global inbox update notification for unjoined participants
      this.server.emit('inboxUpdated', {
        conversationId: data.conversationId,
        lastMessage: message.mediaUrl ? 'Sent a photo' : (message.text || 'Shared a message'),
        lastMessageTime: message.createdAt,
        lastMessageSenderId: senderId,
      });

      // Expo Push Notification logic for background/inactive partner(s)
      this.db.conversation.findUnique({
        where: { id: data.conversationId },
        include: { participants: { select: { userId: true } } },
      }).then(async (conv) => {
        if (!conv) return;

        const partners = conv.participants.filter(p => p.userId !== senderId);
        if (partners.length === 0) return;

        const senderUser = await this.db.user.findUnique({ 
          where: { id: senderId }, 
          select: { displayName: true, username: true } 
        });
        const senderName = senderUser?.displayName || senderUser?.username || 'Someone';
        const bodyText = data.mediaUrl ? 'Sent a photo' : (data.text || 'Shared a message');

        const activeSockets = this.server.sockets.adapter.rooms.get(data.conversationId);

        for (const partner of partners) {
          const partnerId = partner.userId;

          // Check if partner is active in the socket conversation room
          let partnerInRoom = false;
          if (activeSockets) {
            for (const socketId of activeSockets) {
              const s = this.server.sockets.sockets.get(socketId);
              if (s && s.data.userId === partnerId) {
                partnerInRoom = true;
                break;
              }
            }
          }

          // Send push notification if they are not in the room
          if (!partnerInRoom) {
            this.db.user.findUnique({ 
              where: { id: partnerId }, 
              select: { pushToken: true } 
            }).then((partnerUser) => {
              if (partnerUser?.pushToken) {
                fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    to: partnerUser.pushToken,
                    sound: 'default',
                    title: conv.isGroup ? `${conv.groupName || 'Group Chat'}` : senderName,
                    body: conv.isGroup ? `${senderName}: ${bodyText}` : bodyText,
                    data: {
                      conversationId: data.conversationId,
                      type: 'CHAT_MESSAGE',
                    },
                    priority: 'high',
                  }),
                }).catch((e) => {
                  this.logger.warn(`Expo push failed for chat to user ${partnerId}: ${e.message}`);
                });
              }
            }).catch((err) => {
              this.logger.warn(`Failed to fetch user token for user ${partnerId}: ${err.message}`);
            });
          }
        }
      }).catch((err) => {
        this.logger.error(`Error querying push details: ${err.message}`);
      });

      return { success: true, messageId: message.id };
    } catch (err) {
      this.logger.error(`Failed to handle sendMessage: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Real-time read receipts: marks messages as read and broadcasts to conversation room.
   */
  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = socket.data.userId;
    if (!userId) return { success: false, error: 'Unauthorized' };

    try {
      const result = await this.chatService.markConversationMessagesAsRead(
        data.conversationId,
        userId,
      );

      // Broadcast event to notify all participants that messages were read
      this.server.to(data.conversationId).emit('messagesRead', {
        conversationId: data.conversationId,
        readerId: userId,
      });

      return { success: true, count: result.count };
    } catch (err) {
      this.logger.error(`Failed to handle markAsRead: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Broadcast typing status ephemerally to all participants of a room.
   */
  @SubscribeMessage('typingStatus')
  handleTypingStatus(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { conversationId: string; isTyping: boolean },
  ) {
    const senderId = socket.data.userId;
    if (!senderId) return;

    // Send typing event to everyone in the room EXCEPT the sender
    socket.to(data.conversationId).emit('typingStatusReceived', {
      conversationId: data.conversationId,
      senderId,
      isTyping: data.isTyping,
    });
  }

  @OnEvent('notification.created')
  handleNotificationCreated(notification: any) {
    const recipientRoom = `user:${notification.recipientId}`;
    this.logger.debug(`Broadcasting notification to room: ${recipientRoom}`);
    this.server.to(recipientRoom).emit('notificationReceived', notification);
  }

  @OnEvent('message.created')
  handleMessageCreated(payload: { message: any; conversationId: string; senderId: string }) {
    this.logger.debug(`Broadcasting message over event-emitter to room: ${payload.conversationId}`);
    
    // Broadcast the message to the conversation room
    this.server.to(payload.conversationId).emit('messageReceived', payload.message);

    // Also trigger global inbox update notifications for participants
    this.server.emit('inboxUpdated', {
      conversationId: payload.conversationId,
      lastMessage: payload.message.mediaUrl ? 'Sent a photo' : (payload.message.text || 'Shared a message'),
      lastMessageTime: payload.message.createdAt,
      lastMessageSenderId: payload.senderId,
    });
  }
}
