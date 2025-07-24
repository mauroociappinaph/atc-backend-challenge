import { QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { GetAvailabilityQuery } from '../../domain/commands/get-availaiblity.query';
import { RedisService } from '../services/redis.service';
import { SearchController } from './search.controller';

describe('SearchController', () => {
  let controller: SearchController;
  let queryBus: jest.Mocked<QueryBus>;
  let redisService: jest.Mocked<RedisService>;

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
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
    queryBus = module.get(QueryBus);
    redisService = module.get(RedisService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('searchAvailability', () => {
    it('should execute GetAvailabilityQuery with correct parameters', async () => {
      const mockResult = [{ id: 1, name: 'Test Club', courts: [] }];
      queryBus.execute.mockResolvedValue(mockResult);

      const query = { placeId: 'test-place', date: new Date('2024-01-01') };
      const result = await controller.searchAvailability(query);

      expect(queryBus.execute).toHaveBeenCalledWith(
        new GetAvailabilityQuery(query.placeId, query.date),
      );
      expect(result).toBe(mockResult);
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
  });
});
