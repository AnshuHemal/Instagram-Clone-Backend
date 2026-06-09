import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    CacheService,
    {
      provide: 'REDIS_CONFIG',
      useFactory: (config: ConfigService) => ({
        url: config.getOrThrow<string>('UPSTASH_REDIS_REST_URL'),
        token: config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN'),
      }),
      inject: [ConfigService],
    },
  ],
  exports: [CacheService],
})
export class CacheModule {}
