import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { when } from 'jest-when';

import {
  CACHE_SERVICE,
  CacheService,
  RedisCacheService,
} from './cache.service';
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

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith(key)
        .mockResolvedValue(JSON.stringify(testData));

      const result = await service.get<typeof testData>(key);

      expect(result).toEqual(testData);
      expect(redisService.get).toHaveBeenCalledWith(key);
    });

    it('should return null when cache miss', async () => {
      const key = 'test:key';

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get).calledWith(key).mockResolvedValue(null);

      const result = await service.get(key);

      expect(result).toBeNull();
      expect(redisService.get).toHaveBeenCalledWith(key);
    });

    it('should return null when Redis is not connected', async () => {
      const key = 'test:key';

      when(redisService.isConnected).calledWith().mockReturnValue(false);

      const result = await service.get(key);

      expect(result).toBeNull();
      expect(redisService.get).not.toHaveBeenCalled();
    });

    it('should return null and log error when Redis throws', async () => {
      const key = 'test:key';
      const error = new Error('Redis error');

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get).calledWith(key).mockRejectedValue(error);

      const result = await service.get(key);

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value with default TTL for clubs', async () => {
      const testData = { id: 1, name: 'test club' };
      const key = 'clubs:test';
      const defaultTtl = 3600;

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(configService.get)
        .calledWith('CACHE_TTL_CLUBS', defaultTtl)
        .mockReturnValue(defaultTtl);
      when(redisService.set)
        .calledWith(key, JSON.stringify(testData), defaultTtl)
        .mockResolvedValue();

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

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(configService.get)
        .calledWith('CACHE_TTL_COURTS', defaultTtl)
        .mockReturnValue(defaultTtl);
      when(redisService.set)
        .calledWith(key, JSON.stringify(testData), defaultTtl)
        .mockResolvedValue();

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

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(configService.get)
        .calledWith('CACHE_TTL_SLOTS', defaultTtl)
        .mockReturnValue(defaultTtl);
      when(redisService.set)
        .calledWith(key, JSON.stringify(testData), defaultTtl)
        .mockResolvedValue();

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

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.set)
        .calledWith(key, JSON.stringify(testData), customTtl)
        .mockResolvedValue();

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

      when(redisService.isConnected).calledWith().mockReturnValue(false);

      await service.set(key, testData);

      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should not throw when Redis throws error', async () => {
      const testData = { id: 1, name: 'test' };
      const key = 'test:key';
      const error = new Error('Redis error');

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(configService.get)
        .calledWith('CACHE_TTL_SLOTS', 300)
        .mockReturnValue(300);
      when(redisService.set)
        .calledWith(key, JSON.stringify(testData), 300)
        .mockRejectedValue(error);

      await expect(service.set(key, testData)).resolves.not.toThrow();
    });
  });

  describe('del', () => {
    it('should delete key when Redis is connected', async () => {
      const key = 'test:key';

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.del).calledWith(key).mockResolvedValue(1);

      await service.del(key);

      expect(redisService.del).toHaveBeenCalledWith(key);
    });

    it('should skip when Redis is not connected', async () => {
      const key = 'test:key';

      when(redisService.isConnected).calledWith().mockReturnValue(false);

      await service.del(key);

      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('should not throw when Redis throws error', async () => {
      const key = 'test:key';
      const error = new Error('Redis error');

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.del).calledWith(key).mockRejectedValue(error);

      await expect(service.del(key)).resolves.not.toThrow();
    });
  });

  describe('invalidatePattern', () => {
    it('should invalidate keys matching pattern', async () => {
      const pattern = 'clubs:*';
      const matchingKeys = ['clubs:1', 'clubs:2', 'clubs:3'];

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(mockRedisClient.keys)
        .calledWith(pattern)
        .mockResolvedValue(matchingKeys);
      when(mockRedisClient.del)
        .calledWith(...matchingKeys)
        .mockResolvedValue(3);

      await service.invalidatePattern(pattern);

      expect(mockRedisClient.keys).toHaveBeenCalledWith(pattern);
      expect(mockRedisClient.del).toHaveBeenCalledWith(...matchingKeys);
    });

    it('should handle no matching keys', async () => {
      const pattern = 'nonexistent:*';

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(mockRedisClient.keys).calledWith(pattern).mockResolvedValue([]);

      await service.invalidatePattern(pattern);

      expect(mockRedisClient.keys).toHaveBeenCalledWith(pattern);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should skip when Redis is not connected', async () => {
      const pattern = 'test:*';

      when(redisService.isConnected).calledWith().mockReturnValue(false);

      await service.invalidatePattern(pattern);

      expect(mockRedisClient.keys).not.toHaveBeenCalled();
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should not throw when Redis throws error', async () => {
      const pattern = 'test:*';
      const error = new Error('Redis error');

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(mockRedisClient.keys).calledWith(pattern).mockRejectedValue(error);

      await expect(service.invalidatePattern(pattern)).resolves.not.toThrow();
    });
  });
});
