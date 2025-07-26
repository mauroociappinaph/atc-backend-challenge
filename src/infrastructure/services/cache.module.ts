import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CACHE_SERVICE } from '../../domain/tokens';
import { RedisCacheService } from './cache.service';
import { RedisService } from './redis.service';

@Module({
  imports: [ConfigModule],
  providers: [
    RedisService,
    RedisCacheService,
    {
      provide: CACHE_SERVICE,
      useClass: RedisCacheService,
    },
  ],
  exports: [CACHE_SERVICE, RedisService],
})
export class CacheModule {}
