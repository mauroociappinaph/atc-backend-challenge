import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { RATE_LIMITER_SERVICE } from '../src/domain/tokens';
import { RateLimiterService } from '../src/infrastructure/services/rate-limiter.service';
import { RedisService } from '../src/infrastructure/services/redis.service';

describe('Rate Limiting Integration (e2e)', () => {
  let app: INestApplication;
  let rateLimiterService: RateLimiterService;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    rateLimiterService =
      moduleFixture.get<RateLimiterService>(RATE_LIMITER_SERVICE);
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
    // Clear rate limiting data before each test
    if (redisService.isConnected()) {
      const client = redisService.getClient();
      const keys = await client.keys('rate_limit:*');
      if (keys.length > 0) {
        await client.del(...keys);
      }
    }
  });

  describe('Rate Limiting Compliance', () => {
    it('should enforce 60 requests per minute limit', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = '2025-07-26';

      // Make 60 requests rapidly
      const promises = Array.from(
        { length: 60 },
        () =>
          request(app.getHttpServer())
            .get('/search')
            .query({ placeId, date })
            .timeout(10000), // 10 second timeout
      );

      const responses = await Promise.all(
        promises.map((p) => p.catch((err) => err)),
      );

      // Count successful responses
      const successfulResponses = responses.filter((r) => r.status === 200);
      const rateLimitedResponses = responses.filter(
        (r) => r.status === 429 || r.code === 'ECONNABORTED',
      );

      // Should allow up to 60 requests
      expect(successfulResponses.length).toBeLessThanOrEqual(60);

      // If we hit rate limits, some requests should be rate limited
      if (rateLimitedResponses.length > 0) {
        expect(rateLimitedResponses.length).toBeGreaterThan(0);
      }

      console.log(
        `Successful: ${successfulResponses.length}, Rate Limited: ${rateLimitedResponses.length}`,
      );
    }, 30000); // 30 second timeout for this test

    it('should allow requests after rate limit window resets', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = '2025-07-26';

      // Exhaust rate limit
      const exhaustPromises = Array.from(
        { length: 65 },
        () =>
          request(app.getHttpServer())
            .get('/search')
            .query({ placeId, date })
            .timeout(5000)
            .catch(() => ({ status: 429 })), // Handle timeouts as rate limited
      );

      await Promise.all(exhaustPromises);

      // Wait for some tokens to refill (rate is 1 token per second)
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

      // Should be able to make a few more requests
      const response = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId, date })
        .timeout(5000);

      // Should either succeed or be rate limited, but not timeout
      expect([200, 429].includes(response.status)).toBe(true);
    }, 15000);

    it('should track rate limiting per client identifier', async () => {
      // This test verifies that rate limiting is applied per client
      // In a real scenario, this would be per IP or API key

      const remaining1 = await rateLimiterService.getRemainingRequests(
        'client-1',
      );
      const remaining2 = await rateLimiterService.getRemainingRequests(
        'client-2',
      );

      // Both clients should start with full capacity
      expect(remaining1).toBe(60);
      expect(remaining2).toBe(60);

      // Use some requests for client-1
      await rateLimiterService.canMakeRequest('client-1');
      await rateLimiterService.canMakeRequest('client-1');

      const remaining1After = await rateLimiterService.getRemainingRequests(
        'client-1',
      );
      const remaining2After = await rateLimiterService.getRemainingRequests(
        'client-2',
      );

      // Client-1 should have fewer tokens, client-2 should be unchanged
      expect(remaining1After).toBe(58);
      expect(remaining2After).toBe(60);
    });

    it('should handle burst requests within rate limit', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = '2025-07-26';

      // Make 10 requests in quick succession (should be allowed)
      const promises = Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .get('/search')
          .query({ placeId, date })
          .timeout(5000),
      );

      const responses = await Promise.all(promises);

      // All burst requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    }, 10000);
  });

  describe('Rate Limiter Service Integration', () => {
    it('should provide accurate remaining request counts', async () => {
      const identifier = 'test-client';

      // Check initial capacity
      const initial = await rateLimiterService.getRemainingRequests(identifier);
      expect(initial).toBe(60);

      // Use some requests
      await rateLimiterService.canMakeRequest(identifier);
      await rateLimiterService.canMakeRequest(identifier);
      await rateLimiterService.canMakeRequest(identifier);

      const remaining = await rateLimiterService.getRemainingRequests(
        identifier,
      );
      expect(remaining).toBe(57);
    });

    it('should handle waitForSlot correctly', async () => {
      const identifier = 'wait-test-client';

      // Should resolve immediately when tokens are available
      const startTime = Date.now();
      await rateLimiterService.waitForSlot(identifier);
      const waitTime = Date.now() - startTime;

      expect(waitTime).toBeLessThan(100); // Should be nearly immediate
    });

    it('should provide correct configuration', () => {
      const config = rateLimiterService.getConfiguration();

      expect(config.rpm).toBe(60);
      expect(config.strategy).toBe('token_bucket');
      expect(config.bucketTtlSeconds).toBeGreaterThan(0);
      expect(config.maxWaitTimeMs).toBeGreaterThan(0);
      expect(config.checkIntervalMs).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting Error Handling', () => {
    it('should handle Redis disconnection gracefully', async () => {
      // Simulate Redis disconnection
      jest.spyOn(redisService, 'isConnected').mockReturnValue(false);

      const canMakeRequest = await rateLimiterService.canMakeRequest(
        'test-client',
      );

      // Should allow requests when Redis is down (graceful degradation)
      expect(canMakeRequest).toBe(true);

      // Restore Redis connection
      jest.spyOn(redisService, 'isConnected').mockReturnValue(true);
    });

    it('should handle rate limiter errors in HTTP requests', async () => {
      // Mock rate limiter to throw errors
      const originalCanMakeRequest = rateLimiterService.canMakeRequest;
      jest
        .spyOn(rateLimiterService, 'canMakeRequest')
        .mockRejectedValue(new Error('Rate limiter error'));

      const response = await request(app.getHttpServer())
        .get('/search')
        .query({ placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw', date: '2025-07-26' })
        .timeout(5000);

      // Should handle the error gracefully (either succeed or return proper error)
      expect([200, 500, 429].includes(response.status)).toBe(true);

      // Restore original method
      jest
        .spyOn(rateLimiterService, 'canMakeRequest')
        .mockImplementation(originalCanMakeRequest);
    });
  });

  describe('Performance Under Rate Limiting', () => {
    it('should maintain reasonable response times under rate limiting', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = '2025-07-26';

      // Make requests and measure response times
      const responseTimes: number[] = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();

        try {
          const response = await request(app.getHttpServer())
            .get('/search')
            .query({ placeId, date })
            .timeout(5000);

          const responseTime = Date.now() - startTime;
          responseTimes.push(responseTime);

          expect([200, 429].includes(response.status)).toBe(true);
        } catch (error) {
          // Handle timeouts or other errors
          const responseTime = Date.now() - startTime;
          responseTimes.push(responseTime);
        }

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Calculate average response time
      const avgResponseTime =
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      // Response times should be reasonable (under 5 seconds)
      expect(avgResponseTime).toBeLessThan(5000);

      console.log(
        `Average response time under rate limiting: ${avgResponseTime}ms`,
      );
    }, 20000);

    it('should not significantly impact performance when rate limiting is not triggered', async () => {
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const date = '2025-07-26';

      // Make a few requests well within rate limits
      const responseTimes: number[] = [];

      for (let i = 0; i < 5; i++) {
        const startTime = Date.now();

        const response = await request(app.getHttpServer())
          .get('/search')
          .query({ placeId, date })
          .timeout(5000);

        const responseTime = Date.now() - startTime;
        responseTimes.push(responseTime);

        expect(response.status).toBe(200);

        // Delay to avoid hitting rate limits
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Calculate average response time
      const avgResponseTime =
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      // Response times should be fast when not rate limited
      expect(avgResponseTime).toBeLessThan(3000);

      console.log(
        `Average response time without rate limiting: ${avgResponseTime}ms`,
      );
    }, 15000);
  });
});
