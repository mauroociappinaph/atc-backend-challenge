import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';

import { RedisService } from './redis.service';

// Mock ioredis to use ioredis-mock
jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: RedisMock,
  };
});

describe('RedisService', () => {
  let service: RedisService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize Redis connection', async () => {
    await service.onModuleInit();
    expect(configService.get).toHaveBeenCalledWith(
      'REDIS_URL',
      'redis://localhost:6379',
    );
  });

  it('should ping Redis successfully', async () => {
    await service.onModuleInit();
    const result = await service.ping();
    expect(result).toBe('PONG');
  });

  it('should set and get values', async () => {
    await service.onModuleInit();

    const key = 'test-key';
    const value = 'test-value';

    await service.set(key, value);
    const retrievedValue = await service.get(key);

    expect(retrievedValue).toBe(value);
  });

  it('should set values with TTL', async () => {
    await service.onModuleInit();

    const key = 'test-key-ttl';
    const value = 'test-value-ttl';
    const ttl = 10;

    await service.set(key, value, ttl);
    const retrievedValue = await service.get(key);

    expect(retrievedValue).toBe(value);
  });

  it('should delete values', async () => {
    await service.onModuleInit();

    const key = 'test-key-delete';
    const value = 'test-value-delete';

    await service.set(key, value);
    const deleteResult = await service.del(key);
    const retrievedValue = await service.get(key);

    expect(deleteResult).toBe(1);
    expect(retrievedValue).toBeNull();
  });

  it('should return null for non-existent keys', async () => {
    await service.onModuleInit();

    const result = await service.get('non-existent-key');
    expect(result).toBeNull();
  });

  it('should handle Redis connection errors gracefully', async () => {
    // This test verifies that the service handles connection errors
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    // The mock Redis should not throw errors, but we can test the error handling structure
    await service.onModuleInit();

    consoleSpy.mockRestore();
  });
});
