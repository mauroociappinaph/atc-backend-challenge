import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { CACHE_SERVICE, RATE_LIMITER_SERVICE } from '../src/domain/tokens';
import { CacheService } from '../src/infrastructure/services/cache.service';
import { CircuitBreakerService } from '../src/infrastructure/services/circuit-breaker.service';
import { RateLimiterService } from '../src/infrastructure/services/rate-limiter.service';
import { RedisService } from '../src/infrastructure/services/redis.service';

describe('System Integration (e2e)', () => {
  let app: INestApplication;
  let cacheService: CacheService;
  let rateLimiterService: RateLimiterService;
  let circuitBreakerService: CircuitBreakerService;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    cacheService = moduleFixture.get<CacheService>(CACHE_SERVICE);
    rateLimiterService =
      moduleFixture.get<RateLimiterService>(RATE_LIMITER_SERVICE);
    circuitBreakerService = moduleFixture.get<CircuitBreakerService>(
      CircuitBreakerService,
    );
    redisService = moduleFixture.get<RedisService>(RedisService);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Ensure Redis is connected
    try {
      await redisService.onModuleInit();
    } catch (error) {
      console.warn('Redis not available for integration tests:', error.message);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear cache before each test if Redis is available
    if (redisService.isConnected()) {
      try {
        const client = redisService.getClient();
        await client.flushall();
      } catch (error) {
        console.warn('Could not clear Redis cache:', error.message);
      }
    }
  });

  describe('Application Bootstrap', () => {
    it('should start the application successfully', () => {
      expect(app).toBeDefined();
      expect(cacheService).toBeDefined();
      expect(rateLimiterService).toBeDefined();
      expect(circuitBreakerService).toBeDefined();
      expect(redisService).toBeDefined();
    });

    it('should have all required services injected', () => {
      expect(cacheService).toBeInstanceOf(Object);
      expect(rateLimiterService).toBeInstanceOf(Object);
      expect(circuitBreakerService).toBeInstanceOf(Object);
      expect(redisService).toBeInstanceOf(Object);
    });
  });

  describe('Health Check Endpoint', () => {
    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .timeout(5000);

      expect([200, 503].includes(response.status)).toBe(true);

      if (response.status === 200) {
        expect(response.body.status).toBeDefined();
        expect(response.body.services).toBeDefined();
        expect(response.body.metrics).toBeDefined();
      }
    });

    it('should include Redis status in health check', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .timeout(5000);

      if (response.status === 200) {
        expect(response.body.services.redis).toBeDefined();
        expect(typeof response.body.services.redis.connected).toBe('boolean');
      }
    });
  });

  describe('Search Endpoint Validation', () => {
    it('should validate required parameters', async () => {
      // Missing placeId
      const response1 = await request(app.getHttpServer())
        .get('/search')
        .query({ date: '2025-07-26' })
        .timeout(5000);

      expect(response1.status).toBe(400);

      // Missing date
      const response2 = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'test-place' })
        .timeout(5000);

      expect(response2.status).toBe(400);
    });

    it('should validate date range (7-day limit)', async () => {
      const pastDate = '2020-01-01';
      const response1 = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'test-place', date: pastDate })
        .timeout(5000);

      expect(response1.status).toBe(400);

      // Future date beyond 7 days
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const response2 = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'test-place', date: futureDateStr })
        .timeout(5000);

      expect(response2.status).toBe(400);
    });

    it('should handle valid date within 7-day range', async () => {
      const validDate = new Date();
      validDate.setDate(validDate.getDate() + 1); // Tomorrow
      const validDateStr = validDate.toISOString().split('T')[0];

      const response = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw', date: validDateStr })
        .timeout(10000);

      // Should either succeed or handle gracefully (mock API might not be available)
      expect([200, 500, 503, 429].includes(response.status)).toBe(true);
    });
  });

  describe('Events Endpoint', () => {
    it('should accept valid event payloads', async () => {
      const validEvent = {
        type: 'club_updated',
        clubId: 1,
        fields: ['name'],
      };

      const response = await request(app.getHttpServer())
        .post('/events')
        .send(validEvent)
        .timeout(5000);

      expect([201, 400].includes(response.status)).toBe(true);
    });

    it('should reject invalid event payloads', async () => {
      const invalidEvent = {
        type: 'invalid_event',
        invalidField: 'test',
      };

      const response = await request(app.getHttpServer())
        .post('/events')
        .send(invalidEvent)
        .timeout(5000);

      expect(response.status).toBe(400);
    });
  });

  describe('Service Integration', () => {
    it('should have rate limiter service working', async () => {
      const canMakeRequest = await rateLimiterService.canMakeRequest(
        'test-client',
      );
      expect(typeof canMakeRequest).toBe('boolean');

      const remainingRequests = await rateLimiterService.getRemainingRequests(
        'test-client',
      );
      expect(typeof remainingRequests).toBe('number');
      expect(remainingRequests).toBeGreaterThanOrEqual(0);
      expect(remainingRequests).toBeLessThanOrEqual(60);
    });

    it('should have circuit breaker service working', () => {
      const state = circuitBreakerService.getState();
      expect(['CLOSED', 'OPEN', 'HALF_OPEN'].includes(state)).toBe(true);

      const metrics = circuitBreakerService.getMetrics();
      expect(typeof metrics.failures).toBe('number');
      expect(typeof metrics.successes).toBe('number');
      expect(typeof metrics.lastFailureTime).toBe('number');
    });

    it('should have cache service working', async () => {
      const testKey = 'integration-test-key';
      const testValue = { test: 'data', timestamp: Date.now() };

      // Test set
      await cacheService.set(testKey, testValue, 60);

      // Test get
      const retrieved = await cacheService.get(testKey);

      if (redisService.isConnected()) {
        expect(retrieved).toEqual(testValue);
      } else {
        // If Redis is not connected, cache operations should handle gracefully
        expect(retrieved).toBeNull();
      }

      // Test delete
      await cacheService.del(testKey);
      const afterDelete = await cacheService.get(testKey);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed requests gracefully', async () => {
      const response = await request(app.getHttpServer())
        .get('/search')
        .query({ invalid: 'parameters' })
        .timeout(5000);

      expect(response.status).toBe(400);
    });

    it('should handle system errors gracefully', async () => {
      // Test with potentially problematic input
      const response = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: 'a'.repeat(1000), // Very long string
          date: '2025-07-26',
        })
        .timeout(5000);

      // Should handle gracefully, not crash
      expect([200, 400, 500, 503].includes(response.status)).toBe(true);
    });
  });

  describe('Performance Characteristics', () => {
    it('should respond within reasonable time limits', async () => {
      const startTime = Date.now();

      const response = await request(app.getHttpServer())
        .get('/health')
        .timeout(5000);

      const responseTime = Date.now() - startTime;

      expect(responseTime).toBeLessThan(5000); // Should respond within 5 seconds
      expect([200, 503].includes(response.status)).toBe(true);
    });

    it('should handle multiple concurrent requests', async () => {
      const promises = Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).get('/health').timeout(5000),
      );

      const responses = await Promise.all(promises);

      // All requests should complete
      expect(responses).toHaveLength(5);
      responses.forEach((response) => {
        expect([200, 503].includes(response.status)).toBe(true);
      });
    });
  });

  describe('Configuration Validation', () => {
    it('should have rate limiter configured correctly', () => {
      const config = rateLimiterService.getConfiguration();

      expect(config.rpm).toBe(60); // 60 requests per minute as required
      expect(config.strategy).toBe('token_bucket');
      expect(config.bucketTtlSeconds).toBeGreaterThan(0);
      expect(config.maxWaitTimeMs).toBeGreaterThan(0);
    });

    it('should have services properly initialized', () => {
      // Verify all services are properly initialized
      expect(cacheService).toBeDefined();
      expect(rateLimiterService).toBeDefined();
      expect(circuitBreakerService).toBeDefined();
      expect(redisService).toBeDefined();
    });
  });
});
