import { Module } from '@nestjs/common';
import { ReelsController } from './reels.controller';
import { ReelsService } from './reels.service';
import { ReelsRepository } from './reels.repository';

@Module({
  controllers: [ReelsController],
  providers: [ReelsService, ReelsRepository],
  exports: [ReelsService],
})
export class ReelsModule {}
