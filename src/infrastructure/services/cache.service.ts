import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from './redis.service';

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<void>;
}

export const CACHE_SERVICE = Symbol('CACHE_SERVICE');

@Injectable()
export class RedisCacheService implements CacheService {
  private readonly logger = new Logger(RedisCacheService.name);

  // Default TTL values in seconds
  private readonly defaultTtls = {
    clubs: 3600, // 1 hour
    courts: 1800, // 30 minutes
    slots: 300, // 5 minutes
  };

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn('Redis not connected, cache miss for key:', key);
        return null;
      }

      const value = await this.redisService.get(key);
      if (value === null) {
        this.logger.debug(`Cache miss for key: ${key}`);
        return null;
      }

      this.logger.debug(`Cache hit for key: ${key}`);
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Failed to get cache key ${key}:`, error);
      return null; // Graceful degradation
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn(
          'Redis not connected, skipping cache set for key:',
          key,
        );
        return;
      }

      const serializedValue = JSON.stringify(value);
      const effectiveTtl = ttl || this.getDefaultTtl(key);

      await this.redisService.set(key, serializedValue, effectiveTtl);
      this.logger.debug(`Cache set for key: ${key} with TTL: ${effectiveTtl}s`);
    } catch (error) {
      this.logger.error(`Failed to set cache key ${key}:`, error);
      // Don't throw - graceful degradation
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn(
          'Redis not connected, skipping cache delete for key:',
          key,
        );
        return;
      }

      await this.redisService.del(key);
      this.logger.debug(`Cache deleted for key: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete cache key ${key}:`, error);
      // Don't throw - graceful degradation
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn(
          'Redis not connected, skipping pattern invalidation:',
          pattern,
        );
        return;
      }

      const client = this.redisService.getClient();
      const keys = await client.keys(pattern);

      if (keys.length > 0) {
        await client.del(...keys);
        this.logger.debug(
          `Invalidated ${keys.length} keys matching pattern: ${pattern}`,
        );
      } else {
        this.logger.debug(`No keys found for pattern: ${pattern}`);
      }
    } catch (error) {
      this.logger.error(`Failed to invalidate pattern ${pattern}:`, error);
      // Don't throw - graceful degradation
    }
  }

  private getDefaultTtl(key: string): number {
    if (key.startsWith('clubs:')) {
      return this.configService.get<number>(
        'CACHE_TTL_CLUBS',
        this.defaultTtls.clubs,
      );
    }
    if (key.startsWith('courts:')) {
      return this.configService.get<number>(
        'CACHE_TTL_COURTS',
        this.defaultTtls.courts,
      );
    }
    if (key.startsWith('slots:')) {
      return this.configService.get<number>(
        'CACHE_TTL_SLOTS',
        this.defaultTtls.slots,
      );
    }

    // Default fallback
    return this.defaultTtls.slots;
  }
}
