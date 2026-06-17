import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HashtagService } from './hashtag.service';
import { HashtagController } from './hashtag.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [HashtagController],
  providers: [HashtagService],
  exports: [HashtagService],
})
export class HashtagModule {}