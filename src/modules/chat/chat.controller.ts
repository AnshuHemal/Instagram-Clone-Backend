import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Fetch all conversations for the authenticated user.
   */
  @Get('conversations')
  async getConversations(@CurrentUser() user: JwtPayload) {
    return this.chatService.getConversations(user.sub);
  }

  /**
   * Start or retrieve a 1-to-1 conversation with another user.
   */
  @Post('conversations')
  async createConversation(
    @CurrentUser() user: JwtPayload,
    @Body('partnerId') partnerId: string,
  ) {
    return this.chatService.getOrCreateConversation(user.sub, partnerId);
  }

  /**
   * Retrieve message history for a specific conversation with cursor pagination.
   */
  @Get('conversations/:id/messages')
  async getMessages(
    @Param('id') conversationId: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    return this.chatService.getMessages(conversationId, limit, cursor);
  }

  /**
   * Retrieve details of a specific conversation (such as partner details).
   */
  @Get('conversations/:id')
  async getConversation(
    @CurrentUser() user: JwtPayload,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.getConversationById(conversationId, user.sub);
  }
}
