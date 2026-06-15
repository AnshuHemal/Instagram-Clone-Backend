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
import { ChatService } from './chat.service';
import { ChatPresenceService } from './chat-presence.service';

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
    @MessageBody() data: { conversationId: string; text: string; mediaUrl?: string },
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
      );

      // Broadcast the persisted message to the room (including sender)
      this.server.to(data.conversationId).emit('messageReceived', message);

      // Also trigger a global inbox update notification for unjoined participants
      this.server.emit('inboxUpdated', {
        conversationId: data.conversationId,
        lastMessage: message.text,
        lastMessageTime: message.createdAt,
        lastMessageSenderId: senderId,
      });

      return { success: true, messageId: message.id };
    } catch (err) {
      this.logger.error(`Failed to handle sendMessage: ${err.message}`);
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
}
