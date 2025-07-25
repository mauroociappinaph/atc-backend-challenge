import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Logger,
  Query,
  UsePipes,
} from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import * as moment from 'moment';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

import {
  ClubWithAvailability,
  GetAvailabilityQuery,
} from '../../domain/commands/get-availaiblity.query';
import { CACHE_SERVICE } from '../../domain/tokens';
import { CacheService } from '../services/cache.service';
import { RedisService } from '../services/redis.service';

const GetAvailabilitySchema = z.object({
  placeId: z.string().min(1, 'Place ID is required'),
  date: z
    .string()
    .regex(/\d{4}-\d{2}-\d{2}/, 'Date must be in YYYY-MM-DD format')
    .refine((date) => moment(date).isValid(), 'Date must be valid')
    .refine((date) => {
      const inputDate = moment(date);
      const today = moment().startOf('day');
      return inputDate.isSameOrAfter(today, 'day');
    }, 'Date cannot be in the past')
    .refine((date) => {
      const inputDate = moment(date);
      const today = moment().startOf('day');
      const maxDate = today.clone().add(7, 'days');
      return inputDate.isBefore(maxDate, 'day');
    }, 'Date must be within the next 7 days (today + 6 days maximum)')
    .transform((date) => moment(date).toDate()),
});

class GetAvailabilityDTO extends createZodDto(GetAvailabilitySchema) {
  /**
   * Place ID from Google Places API
   * @example "ChIJW9fXNZNTtpURV6VYAumGQOw"
   */
  placeId!: string;

  /**
   * Date for availability search in YYYY-MM-DD format
   * Must be within the next 7 days (today + 6 days maximum)
   * @example "2024-01-15"
   */
  date!: Date;
}

// Health check interfaces for better type safety
interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  services: {
    redis: RedisHealthStatus;
    api: ApiHealthStatus;
  };
  metrics: {
    totalRequests: number;
    cacheHitRatio: number;
    cacheStats: {
      hits: number;
      misses: number;
      total: number;
    };
  };
}

interface RedisHealthStatus {
  connected: boolean;
  ping: string | null;
  operational: boolean;
  error: string | null;
}

interface ApiHealthStatus {
  status: string;
  uptime: number;
}

@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);
  private static readonly HEALTH_CHECK_TTL = 10; // seconds
  private requestCount = 0;
  private cacheMetrics = {
    hits: 0,
    misses: 0,
    total: 0,
  };

  constructor(
    private readonly queryBus: QueryBus,
    private readonly redisService: RedisService,
    @Inject(CACHE_SERVICE) private readonly cacheService: CacheService,
  ) {}

  @Get()
  @UsePipes(ZodValidationPipe)
  async searchAvailability(
    @Query() query: GetAvailabilityDTO,
  ): Promise<ClubWithAvailability[]> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    this.logger.log(
      `[${requestId}] Starting search for placeId: ${
        query.placeId
      }, date: ${moment(query.date).format('YYYY-MM-DD')}`,
    );

    try {
      // Additional validation context for better error messages
      this.validateDateRange(query.date);

      // Estimate cache hit before executing query
      const estimatedCacheHit = await this.estimateCacheHit(
        query.placeId,
        query.date,
      );

      const result = await this.queryBus.execute(
        new GetAvailabilityQuery(query.placeId, query.date),
      );

      // Update cache metrics based on response time (fast response likely indicates cache hit)
      const actualCacheHit = estimatedCacheHit || Date.now() - startTime < 500;
      this.updateCacheMetrics(actualCacheHit);

      const responseTime = Date.now() - startTime;
      const resultCount = result.reduce(
        (total, club) => total + club.courts.length,
        0,
      );

      this.logger.log(
        `[${requestId}] Search completed in ${responseTime}ms - Found ${result.length} clubs with ${resultCount} courts total`,
      );

      // Log performance metrics for monitoring
      this.logPerformanceMetrics(responseTime, result.length, resultCount);

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error(
        `[${requestId}] Search failed after ${responseTime}ms`,
        error,
      );
      throw error;
    }
  }

  private validateDateRange(date: Date): void {
    const inputDate = moment(date);
    const today = moment().startOf('day');
    const maxDate = today.clone().add(7, 'days');

    if (inputDate.isBefore(today, 'day')) {
      throw new BadRequestException(
        `Invalid date: ${inputDate.format(
          'YYYY-MM-DD',
        )} is in the past. Please provide a date from today onwards.`,
      );
    }

    if (inputDate.isSameOrAfter(maxDate, 'day')) {
      const maxAllowedDate = maxDate.clone().subtract(1, 'day');
      throw new BadRequestException(
        `Invalid date: ${inputDate.format(
          'YYYY-MM-DD',
        )} is too far in the future. Maximum allowed date is ${maxAllowedDate.format(
          'YYYY-MM-DD',
        )} (7 days from today).`,
      );
    }
  }

  @Get('health')
  async healthCheck(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    const redisHealth = await this.checkRedisHealth();
    const apiHealth = this.checkApiHealth();

    const overallStatus = this.determineOverallStatus(redisHealth);

    return {
      status: overallStatus,
      timestamp,
      services: {
        redis: redisHealth,
        api: apiHealth,
      },
      metrics: this.getRequestStats(),
    };
  }

  private async checkRedisHealth(): Promise<RedisHealthStatus> {
    const healthStatus: RedisHealthStatus = {
      connected: false,
      ping: null,
      operational: false,
      error: null,
    };

    try {
      healthStatus.connected = this.redisService.isConnected();
      healthStatus.ping = await this.redisService.ping();
      healthStatus.operational = await this.testRedisOperations();
    } catch (error) {
      healthStatus.error =
        error instanceof Error ? error.message : String(error);
      healthStatus.connected = false;
      healthStatus.operational = false;
    }

    return healthStatus;
  }

  private async testRedisOperations(): Promise<boolean> {
    const testKey = this.generateHealthCheckKey();
    const testValue = this.generateTestValue();

    await this.redisService.set(
      testKey,
      testValue,
      SearchController.HEALTH_CHECK_TTL,
    );
    const retrievedValue = await this.redisService.get(testKey);
    await this.redisService.del(testKey);

    return retrievedValue !== null && retrievedValue === testValue;
  }

  private checkApiHealth(): ApiHealthStatus {
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }

  private determineOverallStatus(
    redisHealth: RedisHealthStatus,
  ): 'ok' | 'degraded' | 'error' {
    if (redisHealth.error) {
      return 'error';
    }

    const isRedisHealthy =
      redisHealth.connected &&
      redisHealth.operational &&
      redisHealth.ping === 'PONG';

    return isRedisHealthy ? 'ok' : 'degraded';
  }

  private generateHealthCheckKey(): string {
    return `health-check-${Date.now()}`;
  }

  private generateTestValue(): string {
    return `test-${Math.random().toString(36).substring(7)}`;
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  private async estimateCacheHit(
    placeId: string,
    date: Date,
  ): Promise<boolean> {
    try {
      // Check if clubs data exists in cache
      const clubsKey = `clubs:${placeId}`;
      const clubsData = await this.cacheService.get(clubsKey);

      if (clubsData) {
        // If we have clubs data, it's likely a cache hit scenario
        return true;
      }

      return false;
    } catch (error) {
      // If cache check fails, assume miss
      return false;
    }
  }

  private updateCacheMetrics(isHit: boolean): void {
    this.cacheMetrics.total++;
    if (isHit) {
      this.cacheMetrics.hits++;
    } else {
      this.cacheMetrics.misses++;
    }
  }

  private getCacheHitRatio(): number {
    if (this.cacheMetrics.total === 0) return 0;
    return (this.cacheMetrics.hits / this.cacheMetrics.total) * 100;
  }

  private getRequestStats() {
    return {
      totalRequests: this.requestCount,
      cacheHitRatio: this.getCacheHitRatio(),
      cacheStats: { ...this.cacheMetrics },
    };
  }

  private logPerformanceMetrics(
    responseTime: number,
    clubCount: number,
    courtCount: number,
  ): void {
    this.requestCount++;
    const cacheHitRatio = this.getCacheHitRatio();

    // Log structured performance data for monitoring systems
    this.logger.log(
      JSON.stringify({
        type: 'performance_metrics',
        responseTime,
        clubCount,
        courtCount,
        requestCount: this.requestCount,
        cacheHitRatio: Math.round(cacheHitRatio * 100) / 100, // Round to 2 decimal places
        cacheStats: {
          hits: this.cacheMetrics.hits,
          misses: this.cacheMetrics.misses,
          total: this.cacheMetrics.total,
        },
        timestamp: new Date().toISOString(),
      }),
    );

    // Log cache performance
    if (cacheHitRatio > 80) {
      this.logger.log(
        `Excellent cache performance: ${cacheHitRatio.toFixed(1)}% hit ratio`,
      );
    } else if (cacheHitRatio > 50) {
      this.logger.log(
        `Good cache performance: ${cacheHitRatio.toFixed(1)}% hit ratio`,
      );
    } else if (this.cacheMetrics.total > 10) {
      this.logger.warn(
        `Low cache hit ratio: ${cacheHitRatio.toFixed(
          1,
        )}% - consider cache optimization`,
      );
    }

    // Log performance warnings if response is slow
    if (responseTime > 5000) {
      this.logger.warn(
        `Slow response detected: ${responseTime}ms (>5s threshold)`,
      );
    } else if (responseTime > 2000) {
      this.logger.warn(
        `Moderate response time: ${responseTime}ms (>2s threshold)`,
      );
    }
  }
}
