import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [CloudinaryModule, CacheModule],
  controllers: [PostsController],
  providers: [PostsService, PostsRepository],
  exports: [PostsService],
})
export class PostsModule {}
