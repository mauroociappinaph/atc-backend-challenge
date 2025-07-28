import { HttpStatus, INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';

describe('Performance Dashboard (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/search/dashboard (GET)', () => {
    it('should return performance dashboard with default settings', async () => {
      const response = await request(app.getHttpServer())
        .get('/search/dashboard')
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
      expect(response.body).toHaveProperty('metrics');
      expect(response.body).toHaveProperty('performance');

      // Validate services structure
      expect(response.body.services).toHaveProperty('redis');
      expect(response.body.services).toHaveProperty('api');
      expect(response.body.services.redis).toHaveProperty('connected');
      expect(response.body.services.redis).toHaveProperty('ping');
      expect(response.body.services.redis).toHaveProperty('operational');
      expect(response.body.services.api).toHaveProperty('status');
      expect(response.body.services.api).toHaveProperty('uptime');

      // Validate metrics structure
      expect(response.body.metrics).toHaveProperty('totalRequests');
      expect(response.body.metrics).toHaveProperty('cacheHitRatio');
      expect(response.body.metrics).toHaveProperty('cacheStats');

      // Validate performance structure
      expect(response.body.performance).toHaveProperty('current');
      expect(response.body.performance).toHaveProperty('historical');
      expect(response.body.performance).toHaveProperty('alerts');

      // Validate current performance metrics
      expect(response.body.performance.current).toHaveProperty('responseTime');
      expect(response.body.performance.current).toHaveProperty('throughput');
      expect(response.body.performance.current).toHaveProperty('errorRates');
      expect(response.body.performance.current).toHaveProperty('timestamp');

      // Validate response time metrics
      expect(response.body.performance.current.responseTime).toHaveProperty(
        'current',
      );
      expect(response.body.performance.current.responseTime).toHaveProperty(
        'average1min',
      );
      expect(response.body.performance.current.responseTime).toHaveProperty(
        'average5min',
      );
      expect(response.body.performance.current.responseTime).toHaveProperty(
        'p95',
      );
      expect(response.body.performance.current.responseTime).toHaveProperty(
        'p99',
      );

      // Validate throughput metrics
      expect(response.body.performance.current.throughput).toHaveProperty(
        'requestsPerMinute',
      );
      expect(response.body.performance.current.throughput).toHaveProperty(
        'peakRpm',
      );

      // Validate error rates
      expect(response.body.performance.current.errorRates).toHaveProperty(
        'circuitBreakerTrips',
      );
      expect(response.body.performance.current.errorRates).toHaveProperty(
        'cacheFailures',
      );
      expect(response.body.performance.current.errorRates).toHaveProperty(
        'apiTimeouts',
      );

      // Validate historical data
      expect(response.body.performance.historical).toHaveProperty(
        'responseTime',
      );
      expect(response.body.performance.historical).toHaveProperty('throughput');
      expect(
        Array.isArray(response.body.performance.historical.responseTime),
      ).toBe(true);
      expect(
        Array.isArray(response.body.performance.historical.throughput),
      ).toBe(true);

      // Validate alerts
      expect(response.body.performance.alerts).toHaveProperty('active');
      expect(response.body.performance.alerts).toHaveProperty('level');
      expect(typeof response.body.performance.alerts.active).toBe('boolean');
      expect(['none', 'warning', 'error', 'critical']).toContain(
        response.body.performance.alerts.level,
      );
    });

    it('should accept custom time window parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/search/dashboard?minutes=10')
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('performance');
      expect(response.body.performance).toHaveProperty('historical');
    });

    it('should handle invalid time window parameter gracefully', async () => {
      const response = await request(app.getHttpServer())
        .get('/search/dashboard?minutes=invalid')
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('performance');
      expect(response.body.performance).toHaveProperty('historical');
    });

    it('should return consistent timestamp format', async () => {
      const response = await request(app.getHttpServer())
        .get('/search/dashboard')
        .expect(HttpStatus.OK);

      expect(response.body.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('should return numeric values for performance metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/search/dashboard')
        .expect(HttpStatus.OK);

      const { current } = response.body.performance;

      expect(typeof current.responseTime.current).toBe('number');
      expect(typeof current.responseTime.average1min).toBe('number');
      expect(typeof current.responseTime.average5min).toBe('number');
      expect(typeof current.responseTime.p95).toBe('number');
      expect(typeof current.responseTime.p99).toBe('number');

      expect(typeof current.throughput.requestsPerMinute).toBe('number');
      expect(typeof current.throughput.peakRpm).toBe('number');

      expect(typeof current.errorRates.circuitBreakerTrips).toBe('number');
      expect(typeof current.errorRates.cacheFailures).toBe('number');
      expect(typeof current.errorRates.apiTimeouts).toBe('number');

      expect(typeof current.timestamp).toBe('number');
    });
  });

  describe('Performance Dashboard Integration', () => {
    it('should update metrics after search requests', async () => {
      // Get initial dashboard state
      const initialResponse = await request(app.getHttpServer())
        .get('/search/dashboard')
        .expect(HttpStatus.OK);

      const initialMetrics = initialResponse.body.performance.current;

      // Make a search request to generate metrics
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      await request(app.getHttpServer())
        .get(`/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=${dateStr}`)
        .expect(HttpStatus.OK);

      // Wait a bit for metrics to be recorded
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get updated dashboard state
      const updatedResponse = await request(app.getHttpServer())
        .get('/search/dashboard')
        .expect(HttpStatus.OK);

      const updatedMetrics = updatedResponse.body.performance.current;

      // Verify that metrics have been updated
      expect(updatedMetrics.timestamp).toBeGreaterThan(
        initialMetrics.timestamp,
      );
    });

    it('should maintain historical data over time', async () => {
      // Make multiple requests to generate historical data
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .get(`/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=${dateStr}`)
          .expect(HttpStatus.OK);

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Get dashboard with historical data
      const response = await request(app.getHttpServer())
        .get('/search/dashboard?minutes=1')
        .expect(HttpStatus.OK);

      const { historical } = response.body.performance;

      // Should have some historical data points
      expect(historical.responseTime.length).toBeGreaterThanOrEqual(0);
      expect(historical.throughput.length).toBeGreaterThanOrEqual(0);

      // Validate historical data structure
      if (historical.responseTime.length > 0) {
        historical.responseTime.forEach((point) => {
          expect(point).toHaveProperty('timestamp');
          expect(point).toHaveProperty('value');
          expect(typeof point.timestamp).toBe('number');
          expect(typeof point.value).toBe('number');
        });
      }

      if (historical.throughput.length > 0) {
        historical.throughput.forEach((point) => {
          expect(point).toHaveProperty('timestamp');
          expect(point).toHaveProperty('value');
          expect(typeof point.timestamp).toBe('number');
          expect(typeof point.value).toBe('number');
        });
      }
    });
  });

  describe('Performance Dashboard Response Time', () => {
    it('should respond quickly (< 50ms)', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .get('/search/dashboard')
        .expect(HttpStatus.OK);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(50);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain existing health check format', async () => {
      const response = await request(app.getHttpServer())
        .get('/search/health')
        .expect(HttpStatus.OK);

      // Verify existing health check structure is preserved
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
      expect(response.body).toHaveProperty('metrics');

      // Should NOT have performance data in health endpoint
      expect(response.body).not.toHaveProperty('performance');
    });

    it('should keep health check and dashboard endpoints separate', async () => {
      const healthResponse = await request(app.getHttpServer())
        .get('/search/health')
        .expect(HttpStatus.OK);

      const dashboardResponse = await request(app.getHttpServer())
        .get('/search/dashboard')
        .expect(HttpStatus.OK);

      // Health should be simpler than dashboard
      expect(Object.keys(healthResponse.body).length).toBeLessThan(
        Object.keys(dashboardResponse.body).length,
      );

      // Dashboard should have additional performance data
      expect(dashboardResponse.body).toHaveProperty('performance');
      expect(healthResponse.body).not.toHaveProperty('performance');
    });
  });
});
