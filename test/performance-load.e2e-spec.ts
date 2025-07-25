import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';

describe('Performance Load Tests (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(
      new FastifyAdapter({ logger: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Concurrent Search Requests', () => {
    const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
    const testDate = '2025-07-26'; // Tomorrow

    it('should handle 10 concurrent search requests efficiently', async () => {
      const concurrentRequests = 10;
      const startTime = Date.now();

      // Create array of concurrent requests
      const requests = Array.from({ length: concurrentRequests }, () =>
        request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testPlaceId,
            date: testDate,
          })
          .expect(200),
      );

      // Execute all requests concurrently
      const responses = await Promise.all(requests);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Validate all responses are successful
      responses.forEach((response: any) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('clubs');
        expect(Array.isArray(response.body.clubs)).toBe(true);
      });

      // Performance assertions
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
      console.log(
        `10 concurrent requests completed in ${totalTime}ms (avg: ${
          totalTime / concurrentRequests
        }ms per request)`,
      );
    }, 15000); // 15 second timeout

    it('should handle 25 concurrent search requests with caching benefits', async () => {
      const concurrentRequests = 25;
      const startTime = Date.now();

      // First, make one request to populate cache
      await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        })
        .expect(200);

      // Now make concurrent requests that should benefit from cache
      const requests = Array.from({ length: concurrentRequests }, () =>
        request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testPlaceId,
            date: testDate,
          })
          .expect(200),
      );

      const responses = await Promise.all(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Validate all responses
      responses.forEach((response: any) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('clubs');
      });

      // With caching, this should be much faster
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
      console.log(
        `25 concurrent cached requests completed in ${totalTime}ms (avg: ${
          totalTime / concurrentRequests
        }ms per request)`,
      );
    }, 10000);

    it('should handle mixed concurrent requests for different places', async () => {
      const placeIds = [
        'ChIJW9fXNZNTtpURV6VYAumGQOw',
        'ChIJoYUAHyvmopUR4xJzVPBE_Lw',
      ];
      const concurrentRequests = 20;
      const startTime = Date.now();

      // Create mixed requests for different places
      const requests = Array.from({ length: concurrentRequests }, (_, index) =>
        request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: placeIds[index % placeIds.length],
            date: testDate,
          })
          .expect(200),
      );

      const responses = await Promise.all(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Validate responses
      responses.forEach((response: any) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('clubs');
      });

      expect(totalTime).toBeLessThan(15000); // Should complete within 15 seconds
      console.log(`20 mixed concurrent requests completed in ${totalTime}ms`);
    }, 20000);

    it('should maintain response consistency under load', async () => {
      const concurrentRequests = 15;

      // Make concurrent requests
      const requests = Array.from({ length: concurrentRequests }, () =>
        request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testPlaceId,
            date: testDate,
          })
          .expect(200),
      );

      const responses = await Promise.all(requests);

      // All responses should be identical (same data structure)
      const firstResponse = (responses[0] as any).body;
      responses.forEach((response: any) => {
        expect(response.body).toEqual(firstResponse);
      });
    }, 15000);

    it('should handle burst requests followed by sustained load', async () => {
      const burstSize = 20;
      const sustainedSize = 10;
      const startTime = Date.now();

      // Initial burst
      const burstRequests = Array.from({ length: burstSize }, () =>
        request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testPlaceId,
            date: testDate,
          })
          .expect(200),
      );

      const burstResponses = await Promise.all(burstRequests);
      const burstTime = Date.now() - startTime;

      // Wait a bit, then sustained load
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const sustainedRequests = Array.from({ length: sustainedSize }, () =>
        request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testPlaceId,
            date: testDate,
          })
          .expect(200),
      );

      const sustainedResponses = await Promise.all(sustainedRequests);
      const totalTime = Date.now() - startTime;

      // Validate all responses
      [...burstResponses, ...sustainedResponses].forEach((response: any) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('clubs');
      });

      console.log(
        `Burst (${burstSize} requests): ${burstTime}ms, Total with sustained load: ${totalTime}ms`,
      );
    }, 25000);
  });

  describe('Load Testing with Different Dates', () => {
    const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
    const dates = ['2025-07-26', '2025-07-27', '2025-07-28', '2025-07-29'];

    it('should handle concurrent requests for different dates', async () => {
      const requestsPerDate = 5;
      const startTime = Date.now();

      // Create requests for different dates
      const allRequests: any[] = [];
      for (const date of dates) {
        for (let i = 0; i < requestsPerDate; i++) {
          allRequests.push(
            request(app.getHttpServer())
              .get('/search')
              .query({
                placeId: testPlaceId,
                date: date,
              })
              .expect(200),
          );
        }
      }

      const responses = await Promise.all(allRequests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Validate responses
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('clubs');
      });

      const totalRequests = dates.length * requestsPerDate;
      expect(totalTime).toBeLessThan(20000); // Should complete within 20 seconds
      console.log(
        `${totalRequests} requests across ${dates.length} dates completed in ${totalTime}ms`,
      );
    }, 25000);
  });

  describe('Memory and Resource Usage', () => {
    it('should not cause memory leaks during sustained load', async () => {
      const iterations = 5;
      const requestsPerIteration = 10;
      const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const testDate = '2025-07-26';

      const initialMemory = process.memoryUsage();

      for (let i = 0; i < iterations; i++) {
        const requests = Array.from({ length: requestsPerIteration }, () =>
          request(app.getHttpServer())
            .get('/search')
            .query({
              placeId: testPlaceId,
              date: testDate,
            })
            .expect(200),
        );

        await Promise.all(requests);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        // Small delay between iterations
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
      console.log(
        `Memory increase after ${
          iterations * requestsPerIteration
        } requests: ${Math.round(memoryIncrease / 1024 / 1024)}MB`,
      );
    }, 30000);
  });

  describe('Error Handling Under Load', () => {
    it('should handle invalid requests gracefully under load', async () => {
      const validRequests = 10;
      const invalidRequests = 5;

      const allRequests = [
        // Valid requests
        ...Array.from({ length: validRequests }, () =>
          request(app.getHttpServer()).get('/search').query({
            placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
            date: '2025-07-26',
          }),
        ),
        // Invalid requests (bad date)
        ...Array.from({ length: invalidRequests }, () =>
          request(app.getHttpServer()).get('/search').query({
            placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
            date: '2025-12-31', // Too far in future
          }),
        ),
      ];

      const responses = await Promise.all(
        allRequests.map((req) =>
          req.then(
            (res) => ({ status: 'fulfilled', value: res }),
            (err) => ({ status: 'rejected', reason: err }),
          ),
        ),
      );

      // Count successful and failed responses
      const successful = responses.filter(
        (r: any) => r.status === 'fulfilled' && r.value.status === 200,
      ).length;
      const failed = responses.filter(
        (r: any) => r.status === 'fulfilled' && r.value.status !== 200,
      ).length;

      expect(successful).toBe(validRequests);
      expect(failed).toBe(invalidRequests);
    }, 15000);
  });

  describe('Performance Benchmarks', () => {
    it('should meet performance benchmarks for cached vs uncached requests', async () => {
      const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const testDate = '2025-07-26';

      // First request (uncached)
      const uncachedStart = Date.now();
      const uncachedResponse = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        })
        .expect(200);
      const uncachedTime = Date.now() - uncachedStart;

      // Second request (cached)
      const cachedStart = Date.now();
      const cachedResponse = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        })
        .expect(200);
      const cachedTime = Date.now() - cachedStart;

      // Validate responses are identical
      expect(cachedResponse.body).toEqual(uncachedResponse.body);

      // Cached request should be significantly faster
      expect(cachedTime).toBeLessThan(uncachedTime * 0.5); // At least 50% faster
      console.log(
        `Uncached: ${uncachedTime}ms, Cached: ${cachedTime}ms (${Math.round(
          ((uncachedTime - cachedTime) / uncachedTime) * 100,
        )}% improvement)`,
      );
    }, 10000);

    it('should demonstrate cache hit ratio improvements', async () => {
      const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const testDate = '2025-07-26';
      const totalRequests = 20;

      // Make multiple requests to the same endpoint
      const startTime = Date.now();
      const requests = Array.from({ length: totalRequests }, () =>
        request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testPlaceId,
            date: testDate,
          })
          .expect(200),
      );

      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      // All responses should be successful
      responses.forEach((response: any) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('clubs');
      });

      // Average response time should be very low due to caching
      const avgResponseTime = totalTime / totalRequests;
      expect(avgResponseTime).toBeLessThan(100); // Less than 100ms average

      console.log(
        `${totalRequests} requests completed in ${totalTime}ms (avg: ${avgResponseTime}ms per request)`,
      );
    }, 15000);
  });
});
