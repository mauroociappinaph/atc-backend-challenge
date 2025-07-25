import { Controller, Get, Logger, Query, UsePipes } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import * as moment from 'moment';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

import {
  ClubWithAvailability,
  GetAvailabilityQuery,
} from '../../domain/commands/get-availaiblity.query';
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
      const maxDate = today.clone().add(7, 'days');
      return inputDate.isBetween(today, maxDate, 'day', '[]');
    }, 'Date must be within the next 7 days')
    .transform((date) => moment(date).toDate()),
});

class GetAvailabilityDTO extends createZodDto(GetAvailabilitySchema) {}

// Health check interfaces for better type safety
interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  services: {
    redis: RedisHealthStatus;
    api: ApiHealthStatus;
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

  constructor(
    private readonly queryBus: QueryBus,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  @UsePipes(ZodValidationPipe)
  async searchAvailability(
    @Query() query: GetAvailabilityDTO,
  ): Promise<ClubWithAvailability[]> {
    const startTime = Date.now();

    try {
      const result = await this.queryBus.execute(
        new GetAvailabilityQuery(query.placeId, query.date),
      );

      const responseTime = Date.now() - startTime;
      this.logger.log(
        `Search completed in ${responseTime}ms for placeId: ${query.placeId}`,
      );

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error(
        `Search failed after ${responseTime}ms for placeId: ${query.placeId}`,
        error,
      );
      throw error;
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
}
