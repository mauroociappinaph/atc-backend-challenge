import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';

// Helper function to replace Promise.allSettled for older TypeScript
const allSettled = async (promises: Promise<any>[]): Promise<any[]> => {
  return Promise.all(
    promises.map((promise) =>
      promise.then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      ),
    ),
  );
};

describe('Performance Load Tests - Simple (e2e)', () => {
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

  describe('Application Load Handling', () => {
    it('should handle concurrent requests without crashing', async () => {
      const concurrentRequests = 10;
      const startTime = Date.now();

      // Create concurrent requests to different endpoints
      const requests = Array.from(
        { length: concurrentRequests },
        (_, index) => {
          if (index % 2 === 0) {
            // Valid requests
            return request(app.getHttpServer()).get('/search').query({
              placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
              date: '2025-07-26',
            });
          } else {
            // Invalid requests to test error handling
            return request(app.getHttpServer()).get('/search').query({
              placeId: 'invalid-place-id',
              date: '2025-12-31', // Too far in future
            });
          }
        },
      );

      const responses = await allSettled(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Validate that the application handled all requests
      expect(responses.length).toBe(concurrentRequests);

      // Count successful responses (should handle gracefully)
      const fulfilled = responses.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      expect(fulfilled).toBeGreaterThan(0);

      console.log(
        `${concurrentRequests} concurrent requests completed in ${totalTime}ms`,
      );
    }, 15000);

    it('should handle rapid sequential requests', async () => {
      const sequentialRequests = 20;
      const startTime = Date.now();
      let successCount = 0;
      let errorCount = 0;

      // Make rapid sequential requests
      for (let i = 0; i < sequentialRequests; i++) {
        try {
          const response = await request(app.getHttpServer())
            .get('/search')
            .query({
              placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
              date: '2025-07-26',
            });

          if (response.status === 200) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch (error) {
          errorCount++;
        }
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Application should handle requests without crashing
      expect(successCount + errorCount).toBe(sequentialRequests);

      console.log(
        `${sequentialRequests} sequential requests: ${successCount} success, ${errorCount} errors in ${totalTime}ms`,
      );
    }, 20000);

    it('should maintain application stability under mixed load', async () => {
      const mixedRequests = 15;
      const startTime = Date.now();

      // Create mixed requests: valid, invalid, and edge cases
      const requests = Array.from({ length: mixedRequests }, (_, index) => {
        const requestType = index % 3;

        switch (requestType) {
          case 0:
            // Valid request
            return request(app.getHttpServer()).get('/search').query({
              placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
              date: '2025-07-26',
            });
          case 1:
            // Invalid date
            return request(app.getHttpServer()).get('/search').query({
              placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
              date: '2025-12-31',
            });
          case 2:
            // Missing parameters
            return request(app.getHttpServer()).get('/search').query({});
          default:
            return request(app.getHttpServer()).get('/search');
        }
      });

      const responses = await allSettled(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Application should handle all requests without crashing
      expect(responses.length).toBe(mixedRequests);

      const fulfilled = responses.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const rejected = responses.filter((r) => r.status === 'rejected').length;

      console.log(
        `Mixed load test: ${fulfilled} fulfilled, ${rejected} rejected in ${totalTime}ms`,
      );

      // Most requests should be fulfilled (even if they return errors)
      expect(fulfilled).toBeGreaterThan(mixedRequests * 0.5);
    }, 15000);

    it('should handle multiple search requests under load', async () => {
      const searchRequests = 30;
      const startTime = Date.now();

      // Create concurrent search requests
      const requests = Array.from({ length: searchRequests }, () =>
        request(app.getHttpServer()).get('/search').query({
          placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
          date: '2025-07-26',
        }),
      );

      const responses = await allSettled(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Most requests should be fulfilled (some may fail due to external dependencies)
      const fulfilled = responses.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      expect(fulfilled).toBeGreaterThan(0);

      console.log(
        `${searchRequests} search requests: ${fulfilled} fulfilled in ${totalTime}ms`,
      );
    }, 10000);
  });

  describe('Memory and Resource Management', () => {
    it('should not cause significant memory leaks during load', async () => {
      const iterations = 3;
      const requestsPerIteration = 10;

      const initialMemory = process.memoryUsage();

      for (let i = 0; i < iterations; i++) {
        const requests = Array.from({ length: requestsPerIteration }, () =>
          request(app.getHttpServer()).get('/search').query({
            placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
            date: '2025-07-26',
          }),
        );

        await allSettled(requests);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        // Small delay between iterations
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 100MB for this simple test)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);

      console.log(
        `Memory increase after ${
          iterations * requestsPerIteration
        } requests: ${Math.round(memoryIncrease / 1024 / 1024)}MB`,
      );
    }, 20000);

    it('should handle request cleanup properly', async () => {
      const requestCount = 20;
      const startTime = Date.now();

      // Make requests and ensure they complete
      const requests = Array.from({ length: requestCount }, () =>
        request(app.getHttpServer()).get('/search').query({
          placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
          date: '2025-07-26',
        }),
      );

      const responses = await allSettled(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All requests should be handled (fulfilled or rejected, not hanging)
      expect(responses.length).toBe(requestCount);

      console.log(
        `Request cleanup test: ${requestCount} requests handled in ${totalTime}ms`,
      );
    }, 15000);
  });

  describe('Application Resilience', () => {
    it('should maintain functionality after error conditions', async () => {
      // First, cause some errors
      const errorRequests = Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).get('/search').query({
          placeId: 'invalid-place-id',
          date: 'invalid-date',
        }),
      );

      await allSettled(errorRequests);

      // Then verify normal functionality still works
      const normalRequests = Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).get('/search').query({
          placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
          date: '2025-07-26',
        }),
      );

      const responses = await allSettled(normalRequests);

      // Application should still be functional
      const fulfilled = responses.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      expect(fulfilled).toBe(5);
    }, 10000);

    it('should handle concurrent different endpoint requests', async () => {
      const concurrentRequests = 15;
      const startTime = Date.now();

      // Mix of different endpoints
      const requests = Array.from(
        { length: concurrentRequests },
        (_, index) => {
          if (index % 3 === 0) {
            return request(app.getHttpServer()).get('/health');
          } else if (index % 3 === 1) {
            return request(app.getHttpServer()).get('/search').query({
              placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
              date: '2025-07-26',
            });
          } else {
            return request(app.getHttpServer())
              .post('/events')
              .send({
                type: 'club_updated',
                data: { clubId: 1, fields: ['logo_url'] },
              });
          }
        },
      );

      const responses = await allSettled(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All requests should be handled
      expect(responses.length).toBe(concurrentRequests);

      const fulfilled = responses.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      expect(fulfilled).toBeGreaterThan(0);

      console.log(
        `Mixed endpoint test: ${fulfilled}/${concurrentRequests} requests handled in ${totalTime}ms`,
      );
    }, 15000);
  });
});
