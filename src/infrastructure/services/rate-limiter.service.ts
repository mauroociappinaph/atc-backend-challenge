import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_RATE_LIMITER_CONFIG,
  RATE_LIMITER_CONFIG_KEYS,
  RateLimiterConfig,
} from '../config/rate-limiter.config';
import { RedisService } from './redis.service';

export interface RateLimiterService {
  canMakeRequest(identifier?: string): Promise<boolean>;
  waitForSlot(identifier?: string): Promise<void>;
  getRemainingRequests(identifier?: string): Promise<number>;
  getConfiguration(): RateLimiterConfig;
}

@Injectable()
export class RedisRateLimiterService implements RateLimiterService {
  private readonly logger = new Logger(RedisRateLimiterService.name);

  private static readonly SECONDS_PER_MINUTE = 60;

  private readonly config: RateLimiterConfig;
  private readonly bucketCapacity: number;
  private readonly refillRate: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    // Load configuration from environment variables
    this.config = {
      rpm: Number(
        this.configService.get<number>(
          RATE_LIMITER_CONFIG_KEYS.RPM,
          DEFAULT_RATE_LIMITER_CONFIG.rpm,
        ),
      ),
      bucketTtlSeconds: Number(
        this.configService.get<number>(
          RATE_LIMITER_CONFIG_KEYS.BUCKET_TTL_SECONDS,
          DEFAULT_RATE_LIMITER_CONFIG.bucketTtlSeconds,
        ),
      ),
      maxWaitTimeMs: Number(
        this.configService.get<number>(
          RATE_LIMITER_CONFIG_KEYS.MAX_WAIT_TIME_MS,
          DEFAULT_RATE_LIMITER_CONFIG.maxWaitTimeMs,
        ),
      ),
      checkIntervalMs: Number(
        this.configService.get<number>(
          RATE_LIMITER_CONFIG_KEYS.CHECK_INTERVAL_MS,
          DEFAULT_RATE_LIMITER_CONFIG.checkIntervalMs,
        ),
      ),
      strategy: this.configService.get<'token_bucket' | 'sliding_window'>(
        RATE_LIMITER_CONFIG_KEYS.STRATEGY,
        DEFAULT_RATE_LIMITER_CONFIG.strategy,
      ),
    };

    this.bucketCapacity = this.config.rpm;
    this.refillRate =
      this.config.rpm / RedisRateLimiterService.SECONDS_PER_MINUTE;

    this.logger.log(
      `Rate limiter initialized: ${this.config.rpm} RPM, strategy: ${this.config.strategy}`,
    );
  }

  async canMakeRequest(identifier = 'default'): Promise<boolean> {
    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn(
          'Redis not connected, allowing request (graceful degradation)',
        );
        return true;
      }

      const bucketKey = this.getBucketKey(identifier);
      const now = Date.now();

      // Get current bucket state
      const bucketData = await this.getBucketState(bucketKey);
      const updatedBucket = this.refillBucket(bucketData, now);

      // Check if we can consume a token
      if (updatedBucket.tokens >= 1) {
        updatedBucket.tokens -= 1;
        await this.saveBucketState(bucketKey, updatedBucket);

        this.logger.debug(
          `Request allowed for ${identifier}. Remaining tokens: ${Math.floor(
            updatedBucket.tokens,
          )}`,
        );
        return true;
      }

      this.logger.debug(
        `Request denied for ${identifier}. No tokens available`,
      );
      return false;
    } catch (error) {
      this.logger.error(`Rate limiter error for ${identifier}:`, error);
      // Graceful degradation - allow request on error
      return true;
    }
  }

  async waitForSlot(identifier = 'default'): Promise<void> {
    let waitTime = 0;

    while (waitTime < this.config.maxWaitTimeMs) {
      const canProceed = await this.canMakeRequest(identifier);
      if (canProceed) {
        return;
      }

      await this.sleep(this.config.checkIntervalMs);
      waitTime += this.config.checkIntervalMs;
    }

    this.logger.warn(
      `Rate limiter timeout for ${identifier} after ${this.config.maxWaitTimeMs}ms`,
    );
    throw new Error(`Rate limit timeout for ${identifier}`);
  }

  async getRemainingRequests(identifier = 'default'): Promise<number> {
    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn('Redis not connected, returning max capacity');
        return this.bucketCapacity;
      }

      const bucketKey = this.getBucketKey(identifier);
      const now = Date.now();

      const bucketData = await this.getBucketState(bucketKey);
      const updatedBucket = this.refillBucket(bucketData, now);

      return Math.floor(updatedBucket.tokens);
    } catch (error) {
      this.logger.error(
        `Failed to get remaining requests for ${identifier}:`,
        error,
      );
      return this.bucketCapacity; // Graceful degradation
    }
  }

  /**
   * Get current rate limiter configuration
   */
  getConfiguration(): RateLimiterConfig {
    return { ...this.config };
  }

  private getBucketKey(identifier: string): string {
    return `rate_limit:${identifier}`;
  }

  private async getBucketState(bucketKey: string): Promise<TokenBucket> {
    try {
      const data = await this.redisService.get(bucketKey);
      if (data) {
        return JSON.parse(data) as TokenBucket;
      }
    } catch (error) {
      this.logger.error(`Failed to get bucket state for ${bucketKey}:`, error);
    }

    // Return new bucket if none exists or on error
    return {
      tokens: this.bucketCapacity,
      lastRefill: Date.now(),
    };
  }

  private async saveBucketState(
    bucketKey: string,
    bucket: TokenBucket,
  ): Promise<void> {
    try {
      // Set TTL to clean up inactive buckets
      await this.redisService.set(
        bucketKey,
        JSON.stringify(bucket),
        this.config.bucketTtlSeconds,
      );
    } catch (error) {
      this.logger.error(`Failed to save bucket state for ${bucketKey}:`, error);
    }
  }

  private refillBucket(bucket: TokenBucket, now: number): TokenBucket {
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = (timePassed / 1000) * this.refillRate;

    return {
      tokens: Math.min(this.bucketCapacity, bucket.tokens + tokensToAdd),
      lastRefill: now,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}
