import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { when } from 'jest-when';

import { RATE_LIMITER_SERVICE } from '../../domain/tokens';
import { RATE_LIMITER_CONFIG_KEYS } from '../config/rate-limiter.config';
import {
  RateLimiterService,
  RedisRateLimiterService,
} from './rate-limiter.service';
import { RedisService } from './redis.service';

describe('RedisRateLimiterService', () => {
  let service: RateLimiterService;
  let redisService: jest.Mocked<RedisService>;
  let configService: jest.Mocked<ConfigService>;

  let originalDateNow: () => number;

  beforeEach(async () => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Store original Date.now
    originalDateNow = Date.now;

    const mockRedisService = {
      isConnected: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    // Setup default configuration values
    when(mockConfigService.get)
      .calledWith(RATE_LIMITER_CONFIG_KEYS.RPM, 60)
      .mockReturnValue(60);
    when(mockConfigService.get)
      .calledWith(RATE_LIMITER_CONFIG_KEYS.BUCKET_TTL_SECONDS, 120)
      .mockReturnValue(120);
    when(mockConfigService.get)
      .calledWith(RATE_LIMITER_CONFIG_KEYS.MAX_WAIT_TIME_MS, 60000)
      .mockReturnValue(60000);
    when(mockConfigService.get)
      .calledWith(RATE_LIMITER_CONFIG_KEYS.CHECK_INTERVAL_MS, 100)
      .mockReturnValue(100);
    when(mockConfigService.get)
      .calledWith(RATE_LIMITER_CONFIG_KEYS.STRATEGY, 'token_bucket')
      .mockReturnValue('token_bucket');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisRateLimiterService,
        {
          provide: RATE_LIMITER_SERVICE,
          useExisting: RedisRateLimiterService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RATE_LIMITER_SERVICE);
    redisService = module.get(RedisService) as jest.Mocked<RedisService>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;
  });

  afterEach(() => {
    // Restore Date.now after each test
    Date.now = originalDateNow;
  });

  afterEach(() => {
    // Restore any mocked functions
    jest.restoreAllMocks();
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('canMakeRequest', () => {
    it('should allow request when bucket has tokens', async () => {
      const identifier = 'test-client';
      const bucketData = {
        tokens: 30,
        lastRefill: Date.now() - 1000, // 1 second ago
      };

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:test-client')
        .mockResolvedValue(JSON.stringify(bucketData));
      when(redisService.set)
        .calledWith(expect.any(String), expect.any(String), 120)
        .mockResolvedValue();

      const result = await service.canMakeRequest(identifier);

      expect(result).toBe(true);
      expect(redisService.set).toHaveBeenCalled();
    });

    it('should deny request when bucket has no tokens', async () => {
      const identifier = 'test-client';
      const bucketData = {
        tokens: 0,
        lastRefill: Date.now(),
      };

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:test-client')
        .mockResolvedValue(JSON.stringify(bucketData));

      const result = await service.canMakeRequest(identifier);

      expect(result).toBe(false);
    });

    it('should create new bucket when none exists', async () => {
      const identifier = 'new-client';

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:new-client')
        .mockResolvedValue(null);
      when(redisService.set)
        .calledWith(expect.any(String), expect.any(String), 120)
        .mockResolvedValue();

      const result = await service.canMakeRequest(identifier);

      expect(result).toBe(true);
      expect(redisService.set).toHaveBeenCalled();
    });

    it('should refill tokens based on time passed', async () => {
      const identifier = 'test-client';
      const oneMinuteAgo = Date.now() - 60000; // 1 minute ago
      const bucketData = {
        tokens: 0,
        lastRefill: oneMinuteAgo,
      };

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:test-client')
        .mockResolvedValue(JSON.stringify(bucketData));
      when(redisService.set)
        .calledWith(expect.any(String), expect.any(String), 120)
        .mockResolvedValue();

      const result = await service.canMakeRequest(identifier);

      expect(result).toBe(true);
      expect(redisService.set).toHaveBeenCalledWith(
        'rate_limit:test-client',
        expect.stringContaining('"tokens":59'), // Should have 60 tokens, minus 1 consumed
        120,
      );
    });

    it('should not exceed bucket capacity when refilling', async () => {
      const identifier = 'test-client';
      const twoMinutesAgo = Date.now() - 120000; // 2 minutes ago
      const bucketData = {
        tokens: 30,
        lastRefill: twoMinutesAgo,
      };

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:test-client')
        .mockResolvedValue(JSON.stringify(bucketData));
      when(redisService.set)
        .calledWith(expect.any(String), expect.any(String), 120)
        .mockResolvedValue();

      const result = await service.canMakeRequest(identifier);

      expect(result).toBe(true);
      // Should cap at 60 tokens max, minus 1 consumed = 59
      expect(redisService.set).toHaveBeenCalledWith(
        'rate_limit:test-client',
        expect.stringContaining('"tokens":59'),
        120,
      );
    });

    it('should allow request when Redis is not connected (graceful degradation)', async () => {
      const identifier = 'test-client';

      when(redisService.isConnected).calledWith().mockReturnValue(false);

      const result = await service.canMakeRequest(identifier);

      expect(result).toBe(true);
      expect(redisService.get).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should allow request when Redis throws error (graceful degradation)', async () => {
      const identifier = 'test-client';
      const error = new Error('Redis error');

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:test-client')
        .mockRejectedValue(error);

      const result = await service.canMakeRequest(identifier);

      expect(result).toBe(true);
    });

    it('should use default identifier when none provided', async () => {
      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:default')
        .mockResolvedValue(null);
      when(redisService.set)
        .calledWith(expect.any(String), expect.any(String), 120)
        .mockResolvedValue();

      const result = await service.canMakeRequest();

      expect(result).toBe(true);
      expect(redisService.get).toHaveBeenCalledWith('rate_limit:default');
    });
  });

  describe('getRemainingRequests', () => {
    it('should return remaining tokens in bucket', async () => {
      const identifier = 'test-client';
      const bucketData = {
        tokens: 45.7, // Should floor to 45
        lastRefill: Date.now(),
      };

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:test-client')
        .mockResolvedValue(JSON.stringify(bucketData));

      const result = await service.getRemainingRequests(identifier);

      expect(result).toBe(45);
    });

    it('should return bucket capacity when Redis is not connected', async () => {
      const identifier = 'test-client';

      when(redisService.isConnected).calledWith().mockReturnValue(false);

      const result = await service.getRemainingRequests(identifier);

      expect(result).toBe(60); // Default bucket capacity
    });

    it('should return bucket capacity when Redis throws error', async () => {
      const identifier = 'error-test-client'; // Use unique identifier
      const error = new Error('Redis error');
      const mockTime = Date.now();

      // Mock Date.now to ensure consistent timing
      Date.now = jest.fn(() => mockTime);

      redisService.isConnected.mockReturnValue(true);
      redisService.get.mockRejectedValue(error);

      const result = await service.getRemainingRequests(identifier);

      expect(result).toBe(60); // Default bucket capacity
    });

    it('should account for token refill when calculating remaining requests', async () => {
      const identifier = 'test-client';
      const thirtySecondsAgo = Date.now() - 30000; // 30 seconds ago
      const bucketData = {
        tokens: 30,
        lastRefill: thirtySecondsAgo,
      };

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:test-client')
        .mockResolvedValue(JSON.stringify(bucketData));

      const result = await service.getRemainingRequests(identifier);

      // Should have 30 + (30 seconds * 1 token/second) = 60 tokens (capped at capacity)
      expect(result).toBe(60);
    });
  });

  describe('waitForSlot', () => {
    beforeEach(() => {
      // Mock setTimeout to resolve immediately for testing
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return {} as any;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should resolve immediately when request can be made', async () => {
      const identifier = 'test-client';

      // Mock canMakeRequest to return true on first call
      jest.spyOn(service, 'canMakeRequest').mockResolvedValueOnce(true);

      await expect(service.waitForSlot(identifier)).resolves.not.toThrow();
      expect(service.canMakeRequest).toHaveBeenCalledWith(identifier);
    });

    it('should throw timeout error when max wait time exceeded', async () => {
      const identifier = 'test-client';

      // Mock canMakeRequest to always return false
      jest.spyOn(service, 'canMakeRequest').mockResolvedValue(false);

      await expect(service.waitForSlot(identifier)).rejects.toThrow(
        'Rate limit timeout for test-client',
      );
    });

    it('should eventually resolve when slot becomes available', async () => {
      const identifier = 'test-client';

      // Mock canMakeRequest to return false twice, then true
      jest
        .spyOn(service, 'canMakeRequest')
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await expect(service.waitForSlot(identifier)).resolves.not.toThrow();
      expect(service.canMakeRequest).toHaveBeenCalledTimes(3);
    });
  });

  describe('getConfiguration', () => {
    it('should return current configuration', () => {
      const config = service.getConfiguration();

      expect(config).toEqual({
        rpm: 60,
        bucketTtlSeconds: 120,
        maxWaitTimeMs: 60000,
        checkIntervalMs: 100,
        strategy: 'token_bucket',
      });
    });

    it('should return a copy of configuration (not reference)', () => {
      const config1 = service.getConfiguration();
      const config2 = service.getConfiguration();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
    });
  });

  describe('configuration loading', () => {
    it('should use custom configuration values when provided', async () => {
      // Create a new service instance with custom config
      const customConfigService = {
        get: jest.fn(),
      };

      when(customConfigService.get)
        .calledWith(RATE_LIMITER_CONFIG_KEYS.RPM, 60)
        .mockReturnValue(120); // Custom: 120 RPM
      when(customConfigService.get)
        .calledWith(RATE_LIMITER_CONFIG_KEYS.BUCKET_TTL_SECONDS, 120)
        .mockReturnValue(300); // Custom: 5 minutes TTL
      when(customConfigService.get)
        .calledWith(RATE_LIMITER_CONFIG_KEYS.MAX_WAIT_TIME_MS, 60000)
        .mockReturnValue(30000); // Custom: 30 seconds max wait
      when(customConfigService.get)
        .calledWith(RATE_LIMITER_CONFIG_KEYS.CHECK_INTERVAL_MS, 100)
        .mockReturnValue(50); // Custom: 50ms check interval
      when(customConfigService.get)
        .calledWith(RATE_LIMITER_CONFIG_KEYS.STRATEGY, 'token_bucket')
        .mockReturnValue('sliding_window'); // Custom: sliding window

      const customModule: TestingModule = await Test.createTestingModule({
        providers: [
          RedisRateLimiterService,
          {
            provide: RedisService,
            useValue: redisService,
          },
          {
            provide: ConfigService,
            useValue: customConfigService,
          },
        ],
      }).compile();

      const customService = customModule.get<RedisRateLimiterService>(
        RedisRateLimiterService,
      );
      const config = customService.getConfiguration();

      expect(config).toEqual({
        rpm: 120,
        bucketTtlSeconds: 300,
        maxWaitTimeMs: 30000,
        checkIntervalMs: 50,
        strategy: 'sliding_window',
      });
    });
  });

  describe('token bucket algorithm compliance', () => {
    it('should enforce 60 requests per minute limit', async () => {
      const identifier = 'load-test-client';
      let bucketState = {
        tokens: 60,
        lastRefill: Date.now(),
      };

      redisService.isConnected.mockReturnValue(true);
      redisService.get.mockImplementation(() =>
        Promise.resolve(JSON.stringify(bucketState)),
      );
      redisService.set.mockImplementation((_key, value) => {
        bucketState = JSON.parse(value);
        return Promise.resolve();
      });

      // Should allow first 60 requests
      for (let i = 0; i < 60; i++) {
        const result = await service.canMakeRequest(identifier);
        expect(result).toBe(true);
      }

      // 61st request should be denied
      const result = await service.canMakeRequest(identifier);
      expect(result).toBe(false);
    });

    it('should refill at rate of 1 token per second', async () => {
      const identifier = 'refill-test-client';
      const now = Date.now();

      // Start with empty bucket
      const emptyBucket = {
        tokens: 0,
        lastRefill: now - 5000, // 5 seconds ago
      };

      when(redisService.isConnected).calledWith().mockReturnValue(true);
      when(redisService.get)
        .calledWith('rate_limit:refill-test-client')
        .mockResolvedValue(JSON.stringify(emptyBucket));
      when(redisService.set)
        .calledWith(expect.any(String), expect.any(String), 120)
        .mockResolvedValue();

      const result = await service.canMakeRequest(identifier);

      // Should have 5 tokens (5 seconds * 1 token/second), minus 1 consumed = 4 remaining
      expect(result).toBe(true);
      expect(redisService.set).toHaveBeenCalledWith(
        'rate_limit:refill-test-client',
        expect.stringContaining('"tokens":4'),
        120,
      );
    });

    it('should maintain exact 60 requests per minute rate over time', async () => {
      const identifier = 'rate-test-client';
      let mockTime = Date.now();

      // Mock Date.now to control time progression
      Date.now = jest.fn(() => mockTime);

      redisService.isConnected.mockReturnValue(true);

      // Start with full bucket
      let bucketState = {
        tokens: 60,
        lastRefill: mockTime,
      };

      redisService.get.mockImplementation(() =>
        Promise.resolve(JSON.stringify(bucketState)),
      );
      redisService.set.mockImplementation((_key, value) => {
        bucketState = JSON.parse(value);
        return Promise.resolve();
      });

      // Consume all 60 tokens immediately
      for (let i = 0; i < 60; i++) {
        const result = await service.canMakeRequest(identifier);
        expect(result).toBe(true);
      }

      // Next request should fail
      let result = await service.canMakeRequest(identifier);
      expect(result).toBe(false);

      // Advance time by 30 seconds (should add 30 tokens)
      mockTime += 30000;

      // Should allow 30 more requests
      for (let i = 0; i < 30; i++) {
        result = await service.canMakeRequest(identifier);
        expect(result).toBe(true);
      }

      // 31st request should fail
      result = await service.canMakeRequest(identifier);
      expect(result).toBe(false);

      // Advance time by another 30 seconds (total 60 seconds = 1 minute)
      mockTime += 30000;

      // Should allow another 30 requests (total 60 in the minute)
      for (let i = 0; i < 30; i++) {
        result = await service.canMakeRequest(identifier);
        expect(result).toBe(true);
      }

      // Should not allow more than 60 requests per minute
      result = await service.canMakeRequest(identifier);
      expect(result).toBe(false);

      // Restore original Date.now
      (Date.now as jest.Mock).mockRestore();
    });

    it('should handle burst requests within rate limit', async () => {
      const identifier = 'burst-test-client';

      redisService.isConnected.mockReturnValue(true);

      // Start with full bucket
      let bucketState = {
        tokens: 60,
        lastRefill: Date.now(),
      };

      redisService.get.mockImplementation(() =>
        Promise.resolve(JSON.stringify(bucketState)),
      );

      redisService.set.mockImplementation((_key, value) => {
        bucketState = JSON.parse(value);
        return Promise.resolve();
      });

      // Test first few requests to ensure they work
      for (let i = 0; i < 5; i++) {
        const result = await service.canMakeRequest(identifier);
        expect(result).toBe(true);
      }
    });

    it('should not exceed bucket capacity during refill', async () => {
      const identifier = 'capacity-test-client';
      const mockTime = Date.now();

      Date.now = jest.fn(() => mockTime);

      redisService.isConnected.mockReturnValue(true);

      // Start with partial bucket from 2 minutes ago (should refill but not exceed capacity)
      let bucketState = {
        tokens: 30,
        lastRefill: mockTime - 120000, // 2 minutes ago
      };

      redisService.get.mockImplementation(() =>
        Promise.resolve(JSON.stringify(bucketState)),
      );

      redisService.set.mockImplementation((_key, value) => {
        bucketState = JSON.parse(value);
        return Promise.resolve();
      });

      // Should allow 60 requests total (bucket should be refilled to 60, then consumed)
      for (let i = 0; i < 60; i++) {
        const result = await service.canMakeRequest(identifier);
        expect(result).toBe(true);
      }

      // 61st request should be denied
      const result = await service.canMakeRequest(identifier);
      expect(result).toBe(false);
    });

    it('should handle fractional token calculations correctly', async () => {
      const identifier = 'fractional-test-client';

      redisService.isConnected.mockReturnValue(true);

      // Start with bucket having 1.5 tokens (simulated)
      let bucketState = {
        tokens: 1.5,
        lastRefill: Date.now(),
      };

      redisService.get.mockImplementation(() =>
        Promise.resolve(JSON.stringify(bucketState)),
      );

      redisService.set.mockImplementation((_key, value) => {
        bucketState = JSON.parse(value);
        return Promise.resolve();
      });

      // Should allow 1 request (1.5 tokens available, consume 1, leaving 0.5)
      let result = await service.canMakeRequest(identifier);
      expect(result).toBe(true);

      // Should have 0.5 tokens remaining, so next request should fail
      result = await service.canMakeRequest(identifier);
      expect(result).toBe(false);
    });

    it('should handle sequential requests correctly', async () => {
      const identifier = 'sequential-test-client';

      redisService.isConnected.mockReturnValue(true);

      // Start with bucket having 3 tokens
      let bucketState = {
        tokens: 3,
        lastRefill: Date.now(),
      };

      redisService.get.mockImplementation(() =>
        Promise.resolve(JSON.stringify(bucketState)),
      );

      redisService.set.mockImplementation((_key, value) => {
        bucketState = JSON.parse(value);
        return Promise.resolve();
      });

      // Should allow 3 requests
      for (let i = 0; i < 3; i++) {
        const result = await service.canMakeRequest(identifier);
        expect(result).toBe(true);
      }

      // 4th request should be denied
      const result = await service.canMakeRequest(identifier);
      expect(result).toBe(false);
    });

    it('should validate 60 RPM configuration is correctly applied', async () => {
      // Verify that the service uses the default 60 RPM configuration
      const identifier = 'config-test-client';
      let bucketState = {
        tokens: 60,
        lastRefill: Date.now(),
      };

      redisService.isConnected.mockReturnValue(true);
      redisService.get.mockImplementation(() =>
        Promise.resolve(JSON.stringify(bucketState)),
      );
      redisService.set.mockImplementation((_key, value) => {
        bucketState = JSON.parse(value);
        return Promise.resolve();
      });

      // Should allow exactly 60 requests (default configuration)
      for (let i = 0; i < 60; i++) {
        const result = await service.canMakeRequest(identifier);
        expect(result).toBe(true);
      }

      // 61st request should be denied
      const result = await service.canMakeRequest(identifier);
      expect(result).toBe(false);

      // Verify that the service respects the 60 RPM limit (configuration working correctly)
      expect(result).toBe(false);
    });
  });
});
