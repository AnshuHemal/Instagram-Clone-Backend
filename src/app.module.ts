import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { DatabaseModule } from './modules/database/database.module';
import { CloudinaryModule } from './modules/cloudinary/cloudinary.module';
import { CacheModule } from './modules/cache/cache.module';
import { ReelsModule } from './modules/reels/reels.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AuthModule } from './modules/auth/auth.module';
import { PostsModule } from './modules/posts/posts.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ChatModule } from './modules/chat/chat.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // ── Core Configuration ────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true, // Cache parsed env values for performance
    }),

    // ── Rate Limiting ─────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          {
            name: 'short',  // Burst protection
            ttl: 1000,
            limit: 10,
          },
          {
            name: 'medium', // Sustained request rate
            ttl: 60000,
            limit: 100,
          },
        ],
      }),
    }),

    // ── Task Scheduling (Cron Jobs) ───────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Event Emitter (SSE pub/sub) ───────────────────────────────────────
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
    }),

    // ── Feature Modules ───────────────────────────────────────────────────
    AuthModule,       // Passport JWT strategy
    DatabaseModule,   // Prisma → Neon DB
    CloudinaryModule, // Media storage, HLS transcoding, CDN URLs
    CacheModule,      // Upstash Redis caching layer
    ReelsModule,      // Core Reels CRUD + feed + engagement
    WebhooksModule,   // Cloudinary processing callbacks
    JobsModule,       // Cron: flush Redis stats → Neon DB
    PostsModule,      // Core Feed Posts CRUD + engagement
    NotificationsModule, // User notifications
    ChatModule,       // Real-time Chat Module
  ],
  controllers: [HealthController],
})
export class AppModule {}
