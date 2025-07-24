import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CACHE_SERVICE, RedisCacheService } from './cache.service';
import { RedisService } from './redis.service';

@Module({
  imports: [ConfigModule],
  providers: [
    RedisService,
    {
      provide: CACHE_SERVICE,
      useClass: RedisCacheService,
    },
  ],
  exports: [CACHE_SERVICE],
})
export class CacheModule {}
