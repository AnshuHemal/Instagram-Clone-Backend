import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatPresenceService } from './chat-presence.service';

@Module({
  imports: [AuthModule],
  controllers: [ChatController],
  providers: [ChatService, ChatPresenceService, ChatGateway],
  exports: [ChatService, ChatPresenceService],
})
export class ChatModule {}
