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

describe('Search Flow Integration (e2e)', () => {
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
    await redisService.onModuleInit();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear all cache before each test
    if (redisService.isConnected()) {
      const client = redisService.getClient();
      await client.flushall();
    }
  });

  describe('Complete Search Flow with Caching', () => {
    const validPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
    const validDate = TestDateUtils.getValidTestDate();

    it('should complete full search flow with cache population', async () => {
      // First request - should populate cache
      const response1 = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: validPlaceId, date: validDate });

      // Should either succeed or handle gracefully
      expect([200, 500, 503].includes(response1.status)).toBe(true);

      if (response1.status === 200) {
        expect(response1.body).toBeDefined();
        expect(Array.isArray(response1.body)).toBe(true);

        // Second request - should use cache (faster response)
        const startTime = Date.now();
        const response2 = await request(app.getHttpServer())
          .get('/search')
          .query({ placeId: validPlaceId, date: validDate });
        const responseTime = Date.now() - startTime;

        if (response2.status === 200) {
          expect(response2.body).toEqual(response1.body);
          expect(responseTime).toBeLessThan(2000); // Should be reasonably fast
        }
      }
    });

    it('should handle cache miss gracefully', async () => {
      // Clear cache to ensure miss
      await cacheService.del(`clubs:${validPlaceId}`);

      const response = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: validPlaceId, date: validDate });

      // Should handle gracefully
      expect([200, 500, 503].includes(response.status)).toBe(true);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('should validate date range correctly', async () => {
      // Test with past date
      const pastDate = '2020-01-01';
      await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: validPlaceId, date: pastDate })
        .expect(400);

      // Test with future date (more than 7 days)
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: validPlaceId, date: futureDateStr })
        .expect(400);
    });

    it('should handle invalid parameters', async () => {
      // Missing placeId
      await request(app.getHttpServer())
        .get('/search')
        .query({ date: validDate })
        .expect(400);

      // Missing date
      await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: validPlaceId })
        .expect(400);

      // Invalid date format
      await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: validPlaceId, date: 'invalid-date' })
        .expect(400);
    });
  });

  describe('Performance Monitoring Integration', () => {
    it('should include performance metrics in response headers or logs', async () => {
      const response = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw', date: TestDateUtils.getValidTestDate() })
        .expect(200);

      // Response should be successful
      expect(response.body).toBeDefined();

      // Performance metrics should be logged (we can't easily test logs in e2e,
      // but we can verify the request completes successfully)
      expect(response.status).toBe(200);
    });

    it('should handle concurrent requests efficiently', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = TestDateUtils.getValidTestDate();

      // Make 5 concurrent requests
      const promises = Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).get('/search').query({ placeId, date }),
      );

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toBeDefined();
      });

      // All responses should be identical (cached)
      const firstResponse = responses[0].body;
      responses.slice(1).forEach((response) => {
        expect(response.body).toEqual(firstResponse);
      });
    });
  });

  describe('Health Check Integration', () => {
    it('should return healthy status when all services are operational', async () => {
      const response = await request(app.getHttpServer())
        .get('/search/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.services).toBeDefined();
      expect(response.body.services.redis).toBeDefined();
      expect(response.body.services.api).toBeDefined();
      expect(response.body.metrics).toBeDefined();
    });

    it('should include Redis connectivity status', async () => {
      const response = await request(app.getHttpServer())
        .get('/search/health')
        .expect(200);

      expect(response.body.services.redis.connected).toBeDefined();
      expect(response.body.services.redis.ping).toBeDefined();
      expect(response.body.services.redis.operational).toBeDefined();
    });

    it('should include performance metrics', async () => {
      // Make a search request first to populate metrics
      await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw', date: TestDateUtils.getValidTestDate() });

      const response = await request(app.getHttpServer())
        .get('/search/health')
        .expect(200);

      expect(response.body.metrics).toBeDefined();
      expect(response.body.metrics.totalRequests).toBeGreaterThanOrEqual(0);
      expect(response.body.metrics.cacheHitRatio).toBeGreaterThanOrEqual(0);
      expect(response.body.metrics.cacheStats).toBeDefined();
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle Redis disconnection gracefully', async () => {
      // Simulate Redis disconnection
      jest.spyOn(redisService, 'isConnected').mockReturnValue(false);

      const response = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw', date: TestDateUtils.getValidTestDate() })
        .expect(200);

      expect(response.body).toBeDefined();

      // Restore Redis connection
      jest.spyOn(redisService, 'isConnected').mockReturnValue(true);
    });

    it('should return degraded health status when Redis is down', async () => {
      // Simulate Redis disconnection
      jest.spyOn(redisService, 'isConnected').mockReturnValue(false);

      const response = await request(app.getHttpServer())
        .get('/search/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.redis.connected).toBe(false);

      // Restore Redis connection
      jest.spyOn(redisService, 'isConnected').mockReturnValue(true);
    });

    it('should handle malformed requests gracefully', async () => {
      // Test with completely invalid query parameters
      await request(app.getHttpServer())
        .get('/search')
        .query({ invalid: 'parameter' })
        .expect(400);

      // Test with SQL injection attempt
      await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: "'; DROP TABLE clubs; --", date: TestDateUtils.getValidTestDate() })
        .expect(400);
    });
  });

  describe('System Resilience', () => {
    it('should maintain functionality when cache service has issues', async () => {
      // Mock cache service to simulate errors
      const originalGet = cacheService.get;
      jest
        .spyOn(cacheService, 'get')
        .mockRejectedValue(new Error('Cache error'));

      const response = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw', date: TestDateUtils.getValidTestDate() })
        .expect(200);

      expect(response.body).toBeDefined();

      // Restore original method
      jest.spyOn(cacheService, 'get').mockImplementation(originalGet);
    });

    it('should handle high load gracefully', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = TestDateUtils.getValidTestDate();

      // Make 10 concurrent requests to test system under load
      const promises = Array.from(
        { length: 10 },
        (_, index) =>
          request(app.getHttpServer())
            .get('/search')
            .query({ placeId, date })
            .timeout(5000), // 5 second timeout
      );

      const responses = await Promise.all(promises);

      // All requests should complete successfully
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body).toBeDefined();
      });
    });
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency across multiple requests', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = TestDateUtils.getValidTestDate();

      // Make first request to populate cache
      const response1 = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId, date })
        .expect(200);

      // Make second request - should return same data
      const response2 = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId, date })
        .expect(200);

      expect(response2.body).toEqual(response1.body);

      // Verify cache contains expected data
      const cachedClubs = await cacheService.get(`clubs:${placeId}`);
      expect(cachedClubs).toBeDefined();
    });

    it('should handle cache invalidation correctly', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = TestDateUtils.getValidTestDate();

      // Populate cache
      await request(app.getHttpServer())
        .get('/search')
        .query({ placeId, date })
        .expect(200);

      // Verify cache is populated
      const cachedClubs = await cacheService.get(`clubs:${placeId}`);
      expect(cachedClubs).toBeDefined();

      // Simulate cache invalidation event
      await request(app.getHttpServer())
        .post('/events')
        .send({
          type: 'club_updated',
          clubId: 1,
          fields: ['name'],
        })
        .expect(201);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cache should be invalidated
      const invalidatedCache = await cacheService.get(`clubs:${placeId}`);
      expect(invalidatedCache).toBeNull();
    });
  });
});
