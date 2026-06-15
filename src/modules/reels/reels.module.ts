import { Module } from '@nestjs/common';
import { ReelsController } from './reels.controller';
import { ReelsService } from './reels.service';
import { ReelsRepository } from './reels.repository';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ReelsController],
  providers: [ReelsService, ReelsRepository],
  exports: [ReelsService],
})
export class ReelsModule {}
