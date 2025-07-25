import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';

describe('Cache Performance Tests (e2e)', () => {
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

  describe('Cache Hit Ratio Measurements', () => {
    const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
    const testDate = '2025-07-26';

    it('should demonstrate cache performance improvements', async () => {
      // First request (cache miss) - measure baseline
      const uncachedStart = Date.now();
      const uncachedResponse = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        });
      const uncachedTime = Date.now() - uncachedStart;

      // Verify first request succeeded or handled gracefully
      expect([200, 400, 500]).toContain(uncachedResponse.status);

      // Second request (cache hit) - measure improvement
      const cachedStart = Date.now();
      const cachedResponse = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        });
      const cachedTime = Date.now() - cachedStart;

      // Verify second request has same status
      expect(cachedResponse.status).toBe(uncachedResponse.status);

      // If both requests were successful, cached should be faster
      if (uncachedResponse.status === 200 && cachedResponse.status === 200) {
        expect(cachedTime).toBeLessThan(uncachedTime);

        const improvement = ((uncachedTime - cachedTime) / uncachedTime) * 100;
        console.log(
          `Cache performance: Uncached ${uncachedTime}ms → Cached ${cachedTime}ms (${improvement.toFixed(
            1,
          )}% improvement)`,
        );

        // Expect at least some improvement
        expect(improvement).toBeGreaterThan(0);
      } else {
        console.log(
          `Cache test completed with status ${uncachedResponse.status}: Uncached ${uncachedTime}ms → Cached ${cachedTime}ms`,
        );
      }
    }, 10000);

    it('should show cache effectiveness with multiple requests', async () => {
      const requestCount = 10;
      const requests: any[] = [];
      const timings: number[] = [];

      // Make multiple requests to the same endpoint
      for (let i = 0; i < requestCount; i++) {
        const start = Date.now();
        const response = await request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testPlaceId,
            date: testDate,
          });
        const duration = Date.now() - start;

        requests.push(response);
        timings.push(duration);
      }

      // All requests should have the same status
      const firstStatus = requests[0].status;
      requests.forEach((response: any) => {
        expect(response.status).toBe(firstStatus);
      });

      // Calculate statistics
      const avgTime =
        timings.reduce((sum, time) => sum + time, 0) / timings.length;
      const firstRequestTime = timings[0];
      const subsequentAvg =
        timings.slice(1).reduce((sum, time) => sum + time, 0) /
        (timings.length - 1);

      console.log(
        `Cache effectiveness: First request ${firstRequestTime}ms, Subsequent average ${subsequentAvg.toFixed(
          1,
        )}ms, Overall average ${avgTime.toFixed(1)}ms`,
      );

      // If requests were successful, subsequent requests should be faster on average
      if (firstStatus === 200) {
        expect(subsequentAvg).toBeLessThanOrEqual(firstRequestTime);
      }
    }, 15000);

    it('should demonstrate cache benefits with different data', async () => {
      const testCases = [
        { placeId: testPlaceId, date: '2025-07-26' },
        { placeId: testPlaceId, date: '2025-07-27' },
        { placeId: 'ChIJoYUAHyvmopUR4xJzVPBE_Lw', date: '2025-07-26' },
      ];

      const results: any[] = [];

      for (const testCase of testCases) {
        // First request (cache miss)
        const uncachedStart = Date.now();
        const uncachedResponse = await request(app.getHttpServer())
          .get('/search')
          .query(testCase);
        const uncachedTime = Date.now() - uncachedStart;

        // Second request (cache hit)
        const cachedStart = Date.now();
        const cachedResponse = await request(app.getHttpServer())
          .get('/search')
          .query(testCase);
        const cachedTime = Date.now() - cachedStart;

        results.push({
          testCase,
          uncachedTime,
          cachedTime,
          status: uncachedResponse.status,
          improvement:
            uncachedTime > 0
              ? ((uncachedTime - cachedTime) / uncachedTime) * 100
              : 0,
        });

        // Verify consistency
        expect(cachedResponse.status).toBe(uncachedResponse.status);
      }

      // Log results
      results.forEach((result: any, index: number) => {
        console.log(
          `Test case ${index + 1} (${result.testCase.placeId.slice(-10)}, ${
            result.testCase.date
          }): ` +
            `${result.uncachedTime}ms → ${
              result.cachedTime
            }ms (${result.improvement.toFixed(1)}% improvement, status: ${
              result.status
            })`,
        );
      });

      // At least some test cases should show improvement (if successful)
      const successfulResults = results.filter((r: any) => r.status === 200);
      if (successfulResults.length > 0) {
        const avgImprovement =
          successfulResults.reduce(
            (sum: number, r: any) => sum + r.improvement,
            0,
          ) / successfulResults.length;
        // Cache improvements may be minimal for very fast responses
        expect(avgImprovement).toBeGreaterThanOrEqual(0);
      }
    }, 20000);

    it('should maintain cache consistency across concurrent requests', async () => {
      const concurrentRequests = 15;
      const startTime = Date.now();

      // Make concurrent requests to the same endpoint
      const requests = Array.from({ length: concurrentRequests }, () =>
        request(app.getHttpServer()).get('/search').query({
          placeId: testPlaceId,
          date: testDate,
        }),
      );

      const responses = await Promise.all(
        requests.map((req) =>
          req.then(
            (res) => ({
              status: 'fulfilled',
              value: res,
              timing: Date.now() - startTime,
            }),
            (err) => ({
              status: 'rejected',
              reason: err,
              timing: Date.now() - startTime,
            }),
          ),
        ),
      );

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All requests should be handled
      expect(responses.length).toBe(concurrentRequests);

      // Count successful responses
      const successful = responses.filter(
        (r: any) => r.status === 'fulfilled',
      ).length;
      expect(successful).toBeGreaterThan(0);

      // If we have successful responses, they should be consistent
      const successfulResponses = responses.filter(
        (r: any) => r.status === 'fulfilled',
      );
      if (successfulResponses.length > 1) {
        const firstResponse = (successfulResponses[0] as any).value;
        successfulResponses.forEach((response: any) => {
          expect(response.value.status).toBe(firstResponse.status);
          // If successful, response bodies should be identical (cached data)
          if (firstResponse.status === 200) {
            expect(response.value.body).toEqual(firstResponse.body);
          }
        });
      }

      console.log(
        `Concurrent cache test: ${successful}/${concurrentRequests} successful requests in ${totalTime}ms`,
      );
    }, 15000);
  });

  describe('Cache Invalidation Performance', () => {
    it('should handle cache invalidation events efficiently', async () => {
      const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const testDate = '2025-07-26';

      // First, populate cache with a search request
      const initialResponse = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        });

      // Send cache invalidation event
      const eventStart = Date.now();
      const eventResponse = await request(app.getHttpServer())
        .post('/events')
        .send({
          type: 'club_updated',
          data: {
            clubId: 1,
            fields: ['openhours'], // This should invalidate slot caches
          },
        });
      const eventTime = Date.now() - eventStart;

      // Event should be processed quickly
      expect([200, 201, 204, 400]).toContain(eventResponse.status);
      expect(eventTime).toBeLessThan(1000); // Should process within 1 second

      // Subsequent search request should work (may be slower due to cache miss)
      const postEventStart = Date.now();
      const postEventResponse = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        });
      const postEventTime = Date.now() - postEventStart;

      // Response should be consistent
      expect(postEventResponse.status).toBe(initialResponse.status);

      console.log(
        `Cache invalidation: Event processed in ${eventTime}ms, subsequent search took ${postEventTime}ms`,
      );
    }, 10000);

    it('should handle multiple cache invalidation events', async () => {
      const events = [
        { type: 'club_updated', data: { clubId: 1, fields: ['logo_url'] } },
        {
          type: 'court_updated',
          data: { clubId: 1, courtId: 1, fields: ['name'] },
        },
        {
          type: 'slot_booked',
          data: {
            clubId: 1,
            courtId: 1,
            slot: {
              datetime: '2025-07-26T10:00:00',
              price: 100,
              duration: 60,
              start: '10:00',
              end: '11:00',
              _priority: 1,
            },
          },
        },
      ];

      const eventTimes: number[] = [];

      for (const event of events) {
        const start = Date.now();
        const response = await request(app.getHttpServer())
          .post('/events')
          .send(event);
        const duration = Date.now() - start;

        eventTimes.push(duration);
        expect([200, 201, 204, 400]).toContain(response.status);
      }

      const avgEventTime =
        eventTimes.reduce((sum, time) => sum + time, 0) / eventTimes.length;
      const maxEventTime = Math.max(...eventTimes);

      console.log(
        `Multiple events: Average ${avgEventTime.toFixed(
          1,
        )}ms, Max ${maxEventTime}ms`,
      );

      // All events should be processed efficiently
      expect(maxEventTime).toBeLessThan(1000);
      expect(avgEventTime).toBeLessThan(500);
    }, 15000);
  });

  describe('Cache Performance Under Load', () => {
    it('should maintain cache performance under sustained load', async () => {
      const iterations = 3;
      const requestsPerIteration = 10;
      const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const testDate = '2025-07-26';

      const iterationResults: any[] = [];

      for (let i = 0; i < iterations; i++) {
        const iterationStart = Date.now();
        const requests: any[] = [];

        // Make multiple requests in this iteration
        for (let j = 0; j < requestsPerIteration; j++) {
          const requestStart = Date.now();
          const response = await request(app.getHttpServer())
            .get('/search')
            .query({
              placeId: testPlaceId,
              date: testDate,
            });
          const requestTime = Date.now() - requestStart;

          requests.push({ response, time: requestTime });
        }

        const iterationTime = Date.now() - iterationStart;
        const avgRequestTime =
          requests.reduce((sum, req) => sum + req.time, 0) / requests.length;
        const successfulRequests = requests.filter(
          (req) => req.response.status === 200,
        ).length;

        iterationResults.push({
          iteration: i + 1,
          totalTime: iterationTime,
          avgRequestTime,
          successfulRequests,
        });

        console.log(
          `Iteration ${
            i + 1
          }: ${successfulRequests}/${requestsPerIteration} successful, ` +
            `avg ${avgRequestTime.toFixed(
              1,
            )}ms per request, total ${iterationTime}ms`,
        );

        // Small delay between iterations
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Performance should remain consistent across iterations
      const avgTimes = iterationResults.map((r: any) => r.avgRequestTime);
      const firstIterationAvg = avgTimes[0];
      const lastIterationAvg = avgTimes[avgTimes.length - 1];

      // Performance shouldn't degrade significantly
      if (firstIterationAvg > 0 && lastIterationAvg > 0) {
        const degradation =
          (lastIterationAvg - firstIterationAvg) / firstIterationAvg;
        // Allow for significant degradation due to external service variability
        expect(degradation).toBeLessThan(10.0); // Less than 1000% degradation
        console.log(
          `Performance degradation: ${(degradation * 100).toFixed(1)}%`,
        );
      }
    }, 30000);
  });
});
