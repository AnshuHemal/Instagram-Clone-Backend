import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
   * Create a new group conversation.
   */
  @Post('groups')
  async createGroup(
    @CurrentUser() user: JwtPayload,
    @Body('name') name: string,
    @Body('participantIds') participantIds: string[],
    @Body('groupAvatar') groupAvatar?: string,
  ) {
    return this.chatService.createGroupConversation(user.sub, name, participantIds, groupAvatar);
  }

  /**
   * Update group details (name/avatar).
   */
  @Patch('groups/:id')
  async updateGroup(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body('name') name?: string,
    @Body('groupAvatar') groupAvatar?: string,
  ) {
    return this.chatService.updateGroupDetails(id, user.sub, name, groupAvatar);
  }

  /**
   * Add participants to an existing group conversation.
   */
  @Post('groups/:id/participants')
  async addParticipants(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body('participantIds') participantIds: string[],
  ) {
    return this.chatService.addGroupParticipants(id, user.sub, participantIds);
  }

  /**
   * Remove a participant from a group or leave the group.
   */
  @Delete('groups/:id/participants/:userId')
  async removeParticipant(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.chatService.removeGroupParticipant(id, user.sub, userId);
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

  /**
   * Upload chat media (image/video) to Cloudinary and return the secure URL.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadChatMedia(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const result = await this.chatService.uploadChatMedia(user.sub, file);
    return {
      success: true,
      message: 'Media uploaded successfully',
      data: result,
    };
  }
}
