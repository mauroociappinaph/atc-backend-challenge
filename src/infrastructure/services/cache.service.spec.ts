import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { CacheService, RedisCacheService } from './cache.service';
import { CACHE_SERVICE } from '../../domain/tokens';
import { RedisService } from './redis.service';

describe('RedisCacheService', () => {
  let service: CacheService;
  let redisService: jest.Mocked<RedisService>;
  let configService: jest.Mocked<ConfigService>;
  let mockRedisClient: any;

  beforeEach(async () => {
    mockRedisClient = {
      keys: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: CACHE_SERVICE,
          useClass: RedisCacheService,
        },
        {
          provide: RedisService,
          useValue: {
            isConnected: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            getClient: jest.fn().mockReturnValue(mockRedisClient),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CacheService>(CACHE_SERVICE);
    redisService = module.get(RedisService);
    configService = module.get(ConfigService);
  });

  describe('get', () => {
    it('should return parsed value when cache hit', async () => {
      const testData = { id: 1, name: 'test' };
      const key = 'test:key';

      redisService.isConnected.mockReturnValue(true);
      redisService.get.mockResolvedValue(JSON.stringify(testData));

      const result = await service.get<typeof testData>(key);

      expect(result).toEqual(testData);
      expect(redisService.get).toHaveBeenCalledWith(key);
    });

    it('should return null when cache miss', async () => {
      const key = 'test:key';

      redisService.isConnected.mockReturnValue(true);
      redisService.get.mockResolvedValue(null);

      const result = await service.get(key);

      expect(result).toBeNull();
      expect(redisService.get).toHaveBeenCalledWith(key);
    });

    it('should return null when Redis is not connected', async () => {
      const key = 'test:key';

      redisService.isConnected.mockReturnValue(false);

      const result = await service.get(key);

      expect(result).toBeNull();
      expect(redisService.get).not.toHaveBeenCalled();
    });

    it('should return null and log error when Redis throws', async () => {
      const key = 'test:key';
      const error = new Error('Redis error');

      redisService.isConnected.mockReturnValue(true);
      redisService.get.mockRejectedValue(error);

      const result = await service.get(key);

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value with default TTL for clubs', async () => {
      const testData = { id: 1, name: 'test club' };
      const key = 'clubs:test';
      const defaultTtl = 3600;

      redisService.isConnected.mockReturnValue(true);
      configService.get.mockReturnValue(defaultTtl);
      redisService.set.mockResolvedValue();

      await service.set(key, testData);

      expect(redisService.set).toHaveBeenCalledWith(
        key,
        JSON.stringify(testData),
        defaultTtl,
      );
    });

    it('should set value with default TTL for courts', async () => {
      const testData = { id: 1, name: 'test court' };
      const key = 'courts:test';
      const defaultTtl = 1800;

      redisService.isConnected.mockReturnValue(true);
      configService.get.mockReturnValue(defaultTtl);
      redisService.set.mockResolvedValue();

      await service.set(key, testData);

      expect(redisService.set).toHaveBeenCalledWith(
        key,
        JSON.stringify(testData),
        defaultTtl,
      );
    });

    it('should set value with default TTL for slots', async () => {
      const testData = { price: 100, duration: 60 };
      const key = 'slots:test';
      const defaultTtl = 300;

      redisService.isConnected.mockReturnValue(true);
      configService.get.mockReturnValue(defaultTtl);
      redisService.set.mockResolvedValue();

      await service.set(key, testData);

      expect(redisService.set).toHaveBeenCalledWith(
        key,
        JSON.stringify(testData),
        defaultTtl,
      );
    });

    it('should set value with custom TTL when provided', async () => {
      const testData = { id: 1, name: 'test' };
      const key = 'custom:key';
      const customTtl = 600;

      redisService.isConnected.mockReturnValue(true);
      redisService.set.mockResolvedValue();

      await service.set(key, testData, customTtl);

      expect(redisService.set).toHaveBeenCalledWith(
        key,
        JSON.stringify(testData),
        customTtl,
      );
    });

    it('should skip when Redis is not connected', async () => {
      const testData = { id: 1, name: 'test' };
      const key = 'test:key';

      redisService.isConnected.mockReturnValue(false);

      await service.set(key, testData);

      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should not throw when Redis throws error', async () => {
      const testData = { id: 1, name: 'test' };
      const key = 'test:key';
      const error = new Error('Redis error');

      redisService.isConnected.mockReturnValue(true);
      configService.get.mockReturnValue(300);
      redisService.set.mockRejectedValue(error);

      await expect(service.set(key, testData)).resolves.not.toThrow();
    });
  });

  describe('del', () => {
    it('should delete key when Redis is connected', async () => {
      const key = 'test:key';

      redisService.isConnected.mockReturnValue(true);
      redisService.del.mockResolvedValue(1);

      await service.del(key);

      expect(redisService.del).toHaveBeenCalledWith(key);
    });

    it('should skip when Redis is not connected', async () => {
      const key = 'test:key';

      redisService.isConnected.mockReturnValue(false);

      await service.del(key);

      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('should not throw when Redis throws error', async () => {
      const key = 'test:key';
      const error = new Error('Redis error');

      redisService.isConnected.mockReturnValue(true);
      redisService.del.mockRejectedValue(error);

      await expect(service.del(key)).resolves.not.toThrow();
    });
  });

  describe('invalidatePattern', () => {
    it('should invalidate keys matching pattern', async () => {
      const pattern = 'clubs:*';
      const matchingKeys = ['clubs:1', 'clubs:2', 'clubs:3'];

      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.keys.mockResolvedValue(matchingKeys);
      mockRedisClient.del.mockResolvedValue(3);

      await service.invalidatePattern(pattern);

      expect(mockRedisClient.keys).toHaveBeenCalledWith(pattern);
      expect(mockRedisClient.del).toHaveBeenCalledWith(...matchingKeys);
    });

    it('should handle no matching keys', async () => {
      const pattern = 'nonexistent:*';

      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.keys.mockResolvedValue([]);

      await service.invalidatePattern(pattern);

      expect(mockRedisClient.keys).toHaveBeenCalledWith(pattern);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should skip when Redis is not connected', async () => {
      const pattern = 'test:*';

      redisService.isConnected.mockReturnValue(false);

      await service.invalidatePattern(pattern);

      expect(mockRedisClient.keys).not.toHaveBeenCalled();
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should not throw when Redis throws error', async () => {
      const pattern = 'test:*';
      const error = new Error('Redis error');

      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.keys.mockRejectedValue(error);

      await expect(service.invalidatePattern(pattern)).resolves.not.toThrow();
    });
  });
});
