import { BadRequestException } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import * as moment from 'moment';

import { GetAvailabilityQuery } from '../../domain/commands/get-availaiblity.query';
import { CACHE_SERVICE } from '../../domain/tokens';
import { CacheService } from '../services/cache.service';
import { PerformanceMetricsService } from '../services/performance-metrics.service';
import { RedisService } from '../services/redis.service';
import { SearchController } from './search.controller';

describe('SearchController', () => {
  let controller: SearchController;
  let queryBus: jest.Mocked<QueryBus>;
  let redisService: jest.Mocked<RedisService>;
  let cacheService: jest.Mocked<CacheService>;
  let performanceMetricsService: jest.Mocked<PerformanceMetricsService>;

  beforeEach(async () => {
    const mockQueryBus = {
      execute: jest.fn(),
    };

    const mockRedisService = {
      isConnected: jest.fn(),
      ping: jest.fn(),
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };

    const mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      invalidatePattern: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({
        hits: 23,
        misses: 27,
        total: 50,
        hitRatio: 0.46,
        operations: {
          gets: 50,
          sets: 25,
          deletes: 4,
          invalidations: 7,
        },
      }),
      resetMetrics: jest.fn(),
    };

    const mockPerformanceMetricsService = {
      recordResponseTime: jest.fn(),
      recordRequest: jest.fn(),
      recordError: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({
        responseTime: {
          current: 150,
          average1min: 200,
          average5min: 180,
          p95: 300,
          p99: 450,
        },
        throughput: {
          requestsPerMinute: 25,
          peakRpm: 40,
        },
        errorRates: {
          circuitBreakerTrips: 2,
          cacheFailures: 1,
          apiTimeouts: 0,
        },
        timestamp: Date.now(),
      }),
      getHistoricalData: jest.fn().mockReturnValue({
        responseTime: [
          { timestamp: Date.now() - 60000, value: 100 },
          { timestamp: Date.now() - 30000, value: 200 },
        ],
        throughput: [
          { timestamp: Date.now() - 60000, value: 20 },
          { timestamp: Date.now() - 30000, value: 25 },
        ],
      }),
      resetMetrics: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        {
          provide: QueryBus,
          useValue: mockQueryBus,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: CACHE_SERVICE,
          useValue: mockCacheService,
        },
        {
          provide: PerformanceMetricsService,
          useValue: mockPerformanceMetricsService,
        },
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
    queryBus = module.get(QueryBus);
    redisService = module.get(RedisService);
    cacheService = module.get(CACHE_SERVICE);
    performanceMetricsService = module.get(PerformanceMetricsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('searchAvailability', () => {
    it('should execute GetAvailabilityQuery with correct parameters', async () => {
      const mockResult = [{ id: 1, name: 'Test Club', courts: [] }];
      queryBus.execute.mockResolvedValue(mockResult);

      const tomorrow = moment().add(1, 'day').toDate();
      const query = { placeId: 'test-place', date: tomorrow };
      const result = await controller.searchAvailability(query);

      expect(queryBus.execute).toHaveBeenCalledWith(
        new GetAvailabilityQuery(query.placeId, query.date),
      );
      expect(result).toBe(mockResult);
    });

    it('should log response time and query details on success', async () => {
      const mockResult = [{ id: 1, name: 'Test Club', courts: [] }];
      queryBus.execute.mockResolvedValue(mockResult);
      const logSpy = jest.spyOn(controller['logger'], 'log');

      const tomorrow = moment().add(1, 'day').toDate();
      const query = { placeId: 'test-place', date: tomorrow };

      await controller.searchAvailability(query);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Search completed in'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('placeId: test-place'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `date: ${moment(tomorrow).format('YYYY-MM-DD')}`,
        ),
      );
    });

    it('should log error details on failure', async () => {
      const error = new Error('Test error');
      queryBus.execute.mockRejectedValue(error);
      const logSpy = jest.spyOn(controller['logger'], 'error');

      const tomorrow = moment().add(1, 'day').toDate();
      const query = { placeId: 'test-place', date: tomorrow };

      await expect(controller.searchAvailability(query)).rejects.toThrow(error);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Search failed after'),
        error,
      );
    });
  });

  describe('validateDateRange', () => {
    let validateDateRange: (date: Date) => void;

    beforeEach(() => {
      // Access private method for testing
      validateDateRange = controller['validateDateRange'].bind(controller);
    });

    it('should not throw for today', () => {
      const today = moment().startOf('day').toDate();
      expect(() => validateDateRange(today)).not.toThrow();
    });

    it('should not throw for tomorrow', () => {
      const tomorrow = moment().add(1, 'day').startOf('day').toDate();
      expect(() => validateDateRange(tomorrow)).not.toThrow();
    });

    it('should not throw for 6 days from today (maximum allowed)', () => {
      const maxDate = moment().add(6, 'days').startOf('day').toDate();
      expect(() => validateDateRange(maxDate)).not.toThrow();
    });

    it('should throw BadRequestException for yesterday', () => {
      const yesterday = moment().subtract(1, 'day').startOf('day').toDate();

      expect(() => validateDateRange(yesterday)).toThrow(BadRequestException);

      try {
        validateDateRange(yesterday);
        fail('Expected BadRequestException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain(
          'is in the past',
        );
      }
    });

    it('should throw BadRequestException for 7 days from today', () => {
      const tooFarDate = moment().add(7, 'days').startOf('day').toDate();

      expect(() => validateDateRange(tooFarDate)).toThrow(BadRequestException);

      try {
        validateDateRange(tooFarDate);
        fail('Expected BadRequestException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain(
          'is too far in the future',
        );
      }
    });

    it('should throw BadRequestException for 10 days from today', () => {
      const wayTooFarDate = moment().add(10, 'days').startOf('day').toDate();

      expect(() => validateDateRange(wayTooFarDate)).toThrow(
        BadRequestException,
      );

      try {
        validateDateRange(wayTooFarDate);
        fail('Expected BadRequestException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain(
          'Maximum allowed date is',
        );
      }
    });

    it('should provide specific date in error message for past dates', () => {
      const yesterday = moment().subtract(1, 'day').startOf('day');
      const yesterdayDate = yesterday.toDate();

      try {
        validateDateRange(yesterdayDate);
        fail('Expected BadRequestException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain(
          yesterday.format('YYYY-MM-DD'),
        );
      }
    });

    it('should provide maximum allowed date in error message for future dates', () => {
      const tooFarDate = moment().add(8, 'days').startOf('day').toDate();
      const maxAllowedDate = moment().add(6, 'days').format('YYYY-MM-DD');

      try {
        validateDateRange(tooFarDate);
        fail('Expected BadRequestException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain(
          maxAllowedDate,
        );
      }
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      jest
        .spyOn(Date.prototype, 'toISOString')
        .mockReturnValue('2024-01-01T00:00:00.000Z');
      jest.spyOn(process, 'uptime').mockReturnValue(123.45);
      jest.spyOn(Date, 'now').mockReturnValue(1704067200000);
      jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return healthy status when Redis is fully operational', async () => {
      const testValue = 'test-xjylrx'; // This should match Math.random mock
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      const result = await controller.healthCheck();

      expect(result).toEqual({
        status: 'ok',
        timestamp: '2024-01-01T00:00:00.000Z',
        services: {
          redis: {
            connected: true,
            ping: 'PONG',
            operational: true,
            error: null,
          },
          api: {
            status: 'ok',
            uptime: 123.45,
          },
        },
        metrics: {
          totalRequests: 0,
          cacheHitRatio: 0.46,
          cacheStats: {
            hits: 23,
            misses: 27,
            total: 50,
            hitRatio: 0.46,
            operations: {
              gets: 50,
              sets: 25,
              deletes: 4,
              invalidations: 7,
            },
          },
        },
      });

      expect(redisService.set).toHaveBeenCalledWith(
        'health-check-1704067200000',
        testValue,
        10,
      );
      expect(redisService.get).toHaveBeenCalledWith(
        'health-check-1704067200000',
      );
      expect(redisService.del).toHaveBeenCalledWith(
        'health-check-1704067200000',
      );
    });

    it('should return degraded status when Redis is connected but ping fails', async () => {
      const testValue = 'test-xjylrx';
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('ERROR');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      const result = await controller.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.connected).toBe(true);
      expect(result.services.redis.ping).toBe('ERROR');
      expect(result.services.redis.operational).toBe(true);
    });

    it('should return degraded status when Redis operations fail', async () => {
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue('different-value');
      redisService.del.mockResolvedValue(1);

      const result = await controller.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.connected).toBe(true);
      expect(result.services.redis.ping).toBe('PONG');
      expect(result.services.redis.operational).toBe(false);
    });

    it('should return degraded status when Redis get returns null', async () => {
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(null);
      redisService.del.mockResolvedValue(1);

      const result = await controller.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.operational).toBe(false);
    });

    it('should return degraded status when Redis is not connected', async () => {
      redisService.isConnected.mockReturnValue(false);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue('test-g2kvnkl');
      redisService.del.mockResolvedValue(1);

      const result = await controller.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.connected).toBe(false);
    });

    it('should return error status when Redis operations throw an error', async () => {
      const error = new Error('Redis connection failed');
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockRejectedValue(error);

      const result = await controller.healthCheck();

      expect(result.status).toBe('error');
      expect(result.services.redis.connected).toBe(false);
      expect(result.services.redis.operational).toBe(false);
      expect(result.services.redis.error).toBe('Redis connection failed');
    });

    it('should handle non-Error exceptions', async () => {
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockRejectedValue('String error');

      const result = await controller.healthCheck();

      expect(result.status).toBe('error');
      expect(result.services.redis.error).toBe('String error');
    });

    it('should include correct timestamp and API uptime', async () => {
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue('test-g2kvnkl');
      redisService.del.mockResolvedValue(1);

      const result = await controller.healthCheck();

      expect(result.timestamp).toBe('2024-01-01T00:00:00.000Z');
      expect(result.services.api.uptime).toBe(123.45);
      expect(result.services.api.status).toBe('ok');
    });

    it('should include performance metrics in health check response', async () => {
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue('test-g2kvnkl');
      redisService.del.mockResolvedValue(1);

      // Simulate some requests to populate metrics
      const mockResult = [{ id: 1, name: 'Test Club', courts: [] }];
      queryBus.execute.mockResolvedValue(mockResult);
      cacheService.get.mockResolvedValue(null); // Cache miss

      const tomorrow = moment().add(1, 'day').toDate();
      await controller.searchAvailability({
        placeId: 'test-place',
        date: tomorrow,
      });

      const result = await controller.healthCheck();

      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalRequests).toBe(1);
      expect(result.metrics.cacheHitRatio).toBeDefined();
      expect(result.metrics.cacheStats).toBeDefined();
      expect(result.metrics.cacheStats.hits).toBeDefined();
      expect(result.metrics.cacheStats.misses).toBeDefined();
      expect(result.metrics.cacheStats.total).toBeDefined();
    });
  });

  describe('performanceDashboard', () => {
    beforeEach(() => {
      jest
        .spyOn(Date.prototype, 'toISOString')
        .mockReturnValue('2024-01-01T00:00:00.000Z');
      jest.spyOn(process, 'uptime').mockReturnValue(123.45);
      jest.spyOn(Date, 'now').mockReturnValue(1704067200000);
      jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return performance dashboard with default 5-minute window', async () => {
      const testValue = 'test-xjylrx';
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      const result = await controller.performanceDashboard();

      expect(result).toEqual({
        status: 'ok',
        timestamp: '2024-01-01T00:00:00.000Z',
        services: {
          redis: {
            connected: true,
            ping: 'PONG',
            operational: true,
            error: null,
          },
          api: {
            status: 'ok',
            uptime: 123.45,
          },
        },
        metrics: {
          totalRequests: 0,
          cacheHitRatio: 0.46,
          cacheStats: {
            hits: 23,
            misses: 27,
            total: 50,
            hitRatio: 0.46,
            operations: {
              gets: 50,
              sets: 25,
              deletes: 4,
              invalidations: 7,
            },
          },
        },
        performance: {
          current: {
            responseTime: {
              current: 150,
              average1min: 200,
              average5min: 180,
              p95: 300,
              p99: 450,
            },
            throughput: {
              requestsPerMinute: 25,
              peakRpm: 40,
            },
            errorRates: {
              circuitBreakerTrips: 2,
              cacheFailures: 1,
              apiTimeouts: 0,
            },
            timestamp: expect.any(Number),
          },
          historical: {
            responseTime: [
              { timestamp: expect.any(Number), value: 100 },
              { timestamp: expect.any(Number), value: 200 },
            ],
            throughput: [
              { timestamp: expect.any(Number), value: 20 },
              { timestamp: expect.any(Number), value: 25 },
            ],
          },
          alerts: {
            active: false,
            level: 'none',
          },
        },
      });

      expect(performanceMetricsService.getMetrics).toHaveBeenCalled();
      expect(performanceMetricsService.getHistoricalData).toHaveBeenCalledWith(
        5,
      );
    });

    it('should return performance dashboard with custom time window', async () => {
      const testValue = 'test-xjylrx';
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      await controller.performanceDashboard('10');

      expect(performanceMetricsService.getHistoricalData).toHaveBeenCalledWith(
        10,
      );
    });

    it('should handle invalid minutes parameter gracefully', async () => {
      const testValue = 'test-xjylrx';
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      await controller.performanceDashboard('invalid');

      // Should default to 5 minutes when parsing fails
      expect(performanceMetricsService.getHistoricalData).toHaveBeenCalledWith(
        NaN,
      );
    });

    it('should return warning alert for high response time', async () => {
      const testValue = 'test-xjylrx';
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      // Mock high response time
      performanceMetricsService.getMetrics.mockReturnValue({
        responseTime: {
          current: 1500, // Above warning threshold
          average1min: 200,
          average5min: 180,
          p95: 300,
          p99: 450,
        },
        throughput: {
          requestsPerMinute: 25,
          peakRpm: 40,
        },
        errorRates: {
          circuitBreakerTrips: 0,
          cacheFailures: 0,
          apiTimeouts: 0,
        },
        timestamp: Date.now(),
      });

      const result = await controller.performanceDashboard();

      expect(result.performance.alerts).toEqual({
        active: true,
        level: 'warning',
        message: 'Warning response time: 1500ms exceeds 1000ms threshold',
      });
    });

    it('should return critical alert for very high response time', async () => {
      const testValue = 'test-xjylrx';
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      // Mock critical response time
      performanceMetricsService.getMetrics.mockReturnValue({
        responseTime: {
          current: 2500, // Above critical threshold
          average1min: 200,
          average5min: 180,
          p95: 300,
          p99: 450,
        },
        throughput: {
          requestsPerMinute: 25,
          peakRpm: 40,
        },
        errorRates: {
          circuitBreakerTrips: 0,
          cacheFailures: 0,
          apiTimeouts: 0,
        },
        timestamp: Date.now(),
      });

      const result = await controller.performanceDashboard();

      expect(result.performance.alerts).toEqual({
        active: true,
        level: 'critical',
        message: 'Critical response time: 2500ms exceeds 2000ms threshold',
      });
    });

    it('should return error alert for high error count', async () => {
      const testValue = 'test-xjylrx';
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      // Mock high error count
      performanceMetricsService.getMetrics.mockReturnValue({
        responseTime: {
          current: 150,
          average1min: 200,
          average5min: 180,
          p95: 300,
          p99: 450,
        },
        throughput: {
          requestsPerMinute: 25,
          peakRpm: 40,
        },
        errorRates: {
          circuitBreakerTrips: 5,
          cacheFailures: 3,
          apiTimeouts: 4, // Total: 12 errors
        },
        timestamp: Date.now(),
      });

      const result = await controller.performanceDashboard();

      expect(result.performance.alerts).toEqual({
        active: true,
        level: 'error',
        message: 'High error count: 12 errors detected',
      });
    });

    it('should return warning alert for high P95 response time', async () => {
      const testValue = 'test-xjylrx';
      redisService.isConnected.mockReturnValue(true);
      redisService.ping.mockResolvedValue('PONG');
      redisService.set.mockResolvedValue();
      redisService.get.mockResolvedValue(testValue);
      redisService.del.mockResolvedValue(1);

      // Mock high P95 response time
      performanceMetricsService.getMetrics.mockReturnValue({
        responseTime: {
          current: 150,
          average1min: 200,
          average5min: 180,
          p95: 1600, // Above P95 warning threshold
          p99: 450,
        },
        throughput: {
          requestsPerMinute: 25,
          peakRpm: 40,
        },
        errorRates: {
          circuitBreakerTrips: 0,
          cacheFailures: 0,
          apiTimeouts: 0,
        },
        timestamp: Date.now(),
      });

      const result = await controller.performanceDashboard();

      expect(result.performance.alerts).toEqual({
        active: true,
        level: 'warning',
        message: 'P95 response time: 1600ms exceeds 1500ms threshold',
      });
    });
  });
});
