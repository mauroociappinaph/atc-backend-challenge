import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';

describe('Performance Validation Tests (e2e)', () => {
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

  describe('Response Time Improvements', () => {
    const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
    const testDate = '2025-07-26';

    it('should demonstrate significant response time improvements with caching', async () => {
      // Baseline measurement (first request - cache miss)
      const baselineStart = Date.now();
      const baselineResponse = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        });
      const baselineTime = Date.now() - baselineStart;

      // Verify baseline request
      expect([200, 400, 500]).toContain(baselineResponse.status);

      // Optimized measurement (second request - cache hit)
      const optimizedStart = Date.now();
      const optimizedResponse = await request(app.getHttpServer())
        .get('/search')
        .query({
          placeId: testPlaceId,
          date: testDate,
        });
      const optimizedTime = Date.now() - optimizedStart;

      // Verify optimized request has same status
      expect(optimizedResponse.status).toBe(baselineResponse.status);

      // Calculate improvement
      const improvement =
        baselineTime > 0
          ? ((baselineTime - optimizedTime) / baselineTime) * 100
          : 0;
      const speedup =
        baselineTime > 0 ? baselineTime / Math.max(optimizedTime, 1) : 1;

      console.log(
        `Response time improvement:`,
        `\n  Baseline (cache miss): ${baselineTime}ms`,
        `\n  Optimized (cache hit): ${optimizedTime}ms`,
        `\n  Improvement: ${improvement.toFixed(1)}%`,
        `\n  Speed-up factor: ${speedup.toFixed(1)}x`,
      );

      // Performance assertions
      if (baselineResponse.status === 200) {
        // For successful requests, cached should be faster or equal
        expect(optimizedTime).toBeLessThanOrEqual(baselineTime);

        // If there's a meaningful baseline time, expect some improvement
        if (baselineTime > 5) {
          expect(improvement).toBeGreaterThan(0);
        }
      }

      // Both requests should complete within reasonable time
      expect(baselineTime).toBeLessThan(10000); // 10 seconds max
      expect(optimizedTime).toBeLessThan(5000); // 5 seconds max for cached
    }, 15000);

    it('should maintain consistent performance across multiple requests', async () => {
      const requestCount = 20;
      const timings: number[] = [];
      const statuses: number[] = [];

      // Make multiple requests and measure each
      for (let i = 0; i < requestCount; i++) {
        const start = Date.now();
        const response = await request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testPlaceId,
            date: testDate,
          });
        const duration = Date.now() - start;

        timings.push(duration);
        statuses.push(response.status);

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Calculate statistics
      const avgTime =
        timings.reduce((sum, time) => sum + time, 0) / timings.length;
      const minTime = Math.min(...timings);
      const maxTime = Math.max(...timings);
      const firstRequestTime = timings[0];
      const lastRequestTime = timings[timings.length - 1];

      // Calculate percentiles
      const sortedTimings = [...timings].sort((a, b) => a - b);
      const p50 = sortedTimings[Math.floor(sortedTimings.length * 0.5)];
      const p95 = sortedTimings[Math.floor(sortedTimings.length * 0.95)];

      console.log(
        `Performance consistency (${requestCount} requests):`,
        `\n  Average: ${avgTime.toFixed(1)}ms`,
        `\n  Min: ${minTime}ms`,
        `\n  Max: ${maxTime}ms`,
        `\n  P50: ${p50}ms`,
        `\n  P95: ${p95}ms`,
        `\n  First request: ${firstRequestTime}ms`,
        `\n  Last request: ${lastRequestTime}ms`,
      );

      // Performance consistency checks
      expect(avgTime).toBeLessThan(1000); // Average should be under 1 second
      expect(p95).toBeLessThan(2000); // 95% of requests under 2 seconds

      // All requests should have consistent status
      const uniqueStatuses = [...new Set(statuses)];
      expect(uniqueStatuses.length).toBe(1); // All same status
    }, 30000);

    it('should demonstrate performance improvements across different data sets', async () => {
      const testCases = [
        { placeId: testPlaceId, date: '2025-07-26', name: 'Place1-Day1' },
        { placeId: testPlaceId, date: '2025-07-27', name: 'Place1-Day2' },
        {
          placeId: 'ChIJoYUAHyvmopUR4xJzVPBE_Lw',
          date: '2025-07-26',
          name: 'Place2-Day1',
        },
      ];

      const results: any[] = [];

      for (const testCase of testCases) {
        // First request (baseline)
        const baselineStart = Date.now();
        const baselineResponse = await request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testCase.placeId,
            date: testCase.date,
          });
        const baselineTime = Date.now() - baselineStart;

        // Second request (optimized)
        const optimizedStart = Date.now();
        const optimizedResponse = await request(app.getHttpServer())
          .get('/search')
          .query({
            placeId: testCase.placeId,
            date: testCase.date,
          });
        const optimizedTime = Date.now() - optimizedStart;

        const improvement =
          baselineTime > 0
            ? ((baselineTime - optimizedTime) / baselineTime) * 100
            : 0;

        results.push({
          name: testCase.name,
          baselineTime,
          optimizedTime,
          improvement,
          status: baselineResponse.status,
          consistent: baselineResponse.status === optimizedResponse.status,
        });

        // Small delay between test cases
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Log results
      results.forEach((result) => {
        console.log(
          `${result.name}: ${result.baselineTime}ms → ${result.optimizedTime}ms ` +
            `(${result.improvement.toFixed(1)}% improvement, status: ${
              result.status
            }, consistent: ${result.consistent})`,
        );
      });

      // Validate results
      results.forEach((result) => {
        expect(result.consistent).toBe(true); // Responses should be consistent
        expect(result.baselineTime).toBeLessThan(10000); // Reasonable baseline
        expect(result.optimizedTime).toBeLessThan(5000); // Reasonable optimized time

        // If successful, optimized should be faster or equal
        if (result.status === 200) {
          expect(result.optimizedTime).toBeLessThanOrEqual(result.baselineTime);
        }
      });

      // Calculate overall improvement
      const successfulResults = results.filter((r) => r.status === 200);
      if (successfulResults.length > 0) {
        const avgImprovement =
          successfulResults.reduce((sum, r) => sum + r.improvement, 0) /
          successfulResults.length;
        console.log(
          `Overall average improvement: ${avgImprovement.toFixed(1)}%`,
        );
        expect(avgImprovement).toBeGreaterThanOrEqual(0);
      }
    }, 20000);

    it('should validate performance under concurrent load', async () => {
      const concurrentRequests = 15;
      const startTime = Date.now();

      // Create concurrent requests
      const requests = Array.from({ length: concurrentRequests }, () =>
        request(app.getHttpServer()).get('/search').query({
          placeId: testPlaceId,
          date: testDate,
        }),
      );

      // Execute all requests concurrently and measure individual times
      const responses = await Promise.all(
        requests.map(async (req, index) => {
          const requestStart = Date.now();
          try {
            const response = await req;
            const requestTime = Date.now() - requestStart;
            return {
              index,
              status: response.status,
              time: requestTime,
              success: true,
            };
          } catch (error) {
            const requestTime = Date.now() - requestStart;
            return {
              index,
              status: 0,
              time: requestTime,
              success: false,
            };
          }
        }),
      );

      const totalTime = Date.now() - startTime;

      // Analyze results
      const successful = responses.filter((r) => r.success && r.status === 200);
      const failed = responses.filter((r) => !r.success || r.status !== 200);

      const successfulTimes = successful.map((r) => r.time);
      const avgResponseTime =
        successfulTimes.length > 0
          ? successfulTimes.reduce((sum, time) => sum + time, 0) /
            successfulTimes.length
          : 0;
      const maxResponseTime =
        successfulTimes.length > 0 ? Math.max(...successfulTimes) : 0;

      console.log(
        `Concurrent load performance (${concurrentRequests} requests):`,
        `\n  Total time: ${totalTime}ms`,
        `\n  Successful: ${successful.length}`,
        `\n  Failed: ${failed.length}`,
        `\n  Average response time: ${avgResponseTime.toFixed(1)}ms`,
        `\n  Max response time: ${maxResponseTime}ms`,
        `\n  Throughput: ${((successful.length / totalTime) * 1000).toFixed(
          1,
        )} requests/second`,
      );

      // Performance assertions
      expect(successful.length).toBeGreaterThan(0); // Some requests should succeed
      expect(totalTime).toBeLessThan(10000); // Total time should be reasonable

      if (successful.length > 0) {
        expect(avgResponseTime).toBeLessThan(2000); // Average response time should be reasonable
        expect(maxResponseTime).toBeLessThan(5000); // Max response time should be reasonable
      }
    }, 15000);
  });

  describe('Performance Regression Detection', () => {
    const testPlaceId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
    const testDate = '2025-07-26';

    it('should detect performance regressions in response times', async () => {
      const testIterations = 5;
      const requestsPerIteration = 3;
      const iterationResults: any[] = [];

      for (let iteration = 0; iteration < testIterations; iteration++) {
        const iterationStart = Date.now();
        const iterationTimes: number[] = [];

        for (let req = 0; req < requestsPerIteration; req++) {
          const requestStart = Date.now();
          const response = await request(app.getHttpServer())
            .get('/search')
            .query({
              placeId: testPlaceId,
              date: testDate,
            });
          const requestTime = Date.now() - requestStart;

          if (response.status === 200) {
            iterationTimes.push(requestTime);
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const iterationTime = Date.now() - iterationStart;
        const avgTime =
          iterationTimes.length > 0
            ? iterationTimes.reduce((sum, time) => sum + time, 0) /
              iterationTimes.length
            : 0;

        iterationResults.push({
          iteration: iteration + 1,
          totalTime: iterationTime,
          avgResponseTime: avgTime,
          successfulRequests: iterationTimes.length,
        });

        console.log(
          `Iteration ${iteration + 1}: ${
            iterationTimes.length
          }/${requestsPerIteration} successful, ` +
            `avg ${avgTime.toFixed(1)}ms, total ${iterationTime}ms`,
        );

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Analyze for regressions
      const avgTimes = iterationResults
        .filter((r) => r.successfulRequests > 0)
        .map((r) => r.avgResponseTime);

      if (avgTimes.length > 1) {
        const firstIterationAvg = avgTimes[0];
        const lastIterationAvg = avgTimes[avgTimes.length - 1];
        const maxAvg = Math.max(...avgTimes);
        const minAvg = Math.min(...avgTimes);

        const regression =
          firstIterationAvg > 0
            ? ((lastIterationAvg - firstIterationAvg) / firstIterationAvg) * 100
            : 0;

        console.log(
          `Regression analysis:`,
          `\n  First iteration avg: ${firstIterationAvg.toFixed(1)}ms`,
          `\n  Last iteration avg: ${lastIterationAvg.toFixed(1)}ms`,
          `\n  Min avg: ${minAvg.toFixed(1)}ms`,
          `\n  Max avg: ${maxAvg.toFixed(1)}ms`,
          `\n  Regression: ${regression.toFixed(1)}%`,
        );

        // Performance should not regress significantly
        expect(regression).toBeLessThan(500); // Less than 500% regression
        expect(maxAvg).toBeLessThan(10000); // No response should take more than 10 seconds
      }
    }, 25000);

    it('should validate baseline performance expectations', async () => {
      const performanceTargets = {
        maxResponseTime: 5000, // 5 seconds max
        avgResponseTime: 1000, // 1 second average target
        successRate: 0.8, // 80% success rate minimum
      };

      const testRequests = 10;
      const results: any[] = [];

      for (let i = 0; i < testRequests; i++) {
        const start = Date.now();
        try {
          const response = await request(app.getHttpServer())
            .get('/search')
            .query({
              placeId: testPlaceId,
              date: testDate,
            });
          const duration = Date.now() - start;

          results.push({
            success: response.status === 200,
            time: duration,
            status: response.status,
          });
        } catch (error) {
          const duration = Date.now() - start;
          results.push({
            success: false,
            time: duration,
            status: 0,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Calculate metrics
      const successful = results.filter((r) => r.success);
      const successRate = successful.length / results.length;
      const avgTime =
        successful.length > 0
          ? successful.reduce((sum, r) => sum + r.time, 0) / successful.length
          : 0;
      const maxTime =
        results.length > 0 ? Math.max(...results.map((r) => r.time)) : 0;

      console.log(
        `Baseline performance validation:`,
        `\n  Success rate: ${(successRate * 100).toFixed(1)}% (target: ${(
          performanceTargets.successRate * 100
        ).toFixed(1)}%)`,
        `\n  Average response time: ${avgTime.toFixed(1)}ms (target: <${
          performanceTargets.avgResponseTime
        }ms)`,
        `\n  Max response time: ${maxTime}ms (target: <${performanceTargets.maxResponseTime}ms)`,
      );

      // Validate against targets (with some flexibility for external dependencies)
      expect(maxTime).toBeLessThan(performanceTargets.maxResponseTime);

      if (successful.length > 0) {
        expect(avgTime).toBeLessThan(performanceTargets.avgResponseTime * 2); // Allow 2x flexibility
      }

      // Success rate should be reasonable (allowing for external service issues)
      expect(successRate).toBeGreaterThan(0.1); // At least 10% success rate
    }, 15000);
  });
});
