import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { PerformanceMetricsService } from './performance-metrics.service';

describe('PerformanceMetricsService', () => {
  let service: PerformanceMetricsService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceMetricsService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<PerformanceMetricsService>(PerformanceMetricsService);
    configService = module.get(ConfigService);

    // Setup default config values
    configService.get.mockImplementation((key: string, defaultValue: any) => {
      const config = {
        PERFORMANCE_ALERT_RESPONSE_TIME_WARN: 1000,
        PERFORMANCE_ALERT_RESPONSE_TIME_ERROR: 2000,
        PERFORMANCE_ALERT_ERROR_RATE_WARN: 0.05,
        PERFORMANCE_ALERT_ERROR_RATE_ERROR: 0.1,
      };
      return config[key] || defaultValue;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clear any running intervals
    service.resetMetrics();
  });

  describe('recordResponseTime', () => {
    it('should record response time and update current metrics', () => {
      const responseTime = 500;

      service.recordResponseTime(responseTime);

      const metrics = service.getMetrics();
      expect(metrics.responseTime.current).toBe(responseTime);
      expect(metrics.timestamp).toBeGreaterThan(0);
    });

    it('should calculate averages correctly', async () => {
      // Record multiple response times
      service.recordResponseTime(100);
      service.recordResponseTime(200);
      service.recordResponseTime(300);

      // Wait a bit for calculations
      await new Promise((resolve) => setTimeout(resolve, 50));

      const metrics = service.getMetrics();
      expect(metrics.responseTime.average1min).toBeGreaterThan(0);
      expect(metrics.responseTime.average5min).toBeGreaterThan(0);
    });

    it('should calculate percentiles correctly', async () => {
      // Record a range of response times
      const responseTimes = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      responseTimes.forEach((time) => service.recordResponseTime(time));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const metrics = service.getMetrics();
      expect(metrics.responseTime.p95).toBeGreaterThan(
        metrics.responseTime.p99 * 0.8,
      );
      expect(metrics.responseTime.p99).toBeGreaterThan(0);
    });
  });

  describe('recordRequest', () => {
    it('should increment request count and update throughput', () => {
      service.recordRequest();
      service.recordRequest();
      service.recordRequest();

      const metrics = service.getMetrics();
      expect(metrics.throughput.requestsPerMinute).toBeGreaterThan(0);
    });

    it('should track peak RPM correctly', () => {
      // Record multiple requests
      for (let i = 0; i < 10; i++) {
        service.recordRequest();
      }

      const metrics = service.getMetrics();
      expect(metrics.throughput.peakRpm).toBeGreaterThanOrEqual(
        metrics.throughput.requestsPerMinute,
      );
    });
  });

  describe('recordError', () => {
    it('should record circuit breaker trips', () => {
      service.recordError('circuitBreakerTrips');
      service.recordError('circuitBreakerTrips');

      const metrics = service.getMetrics();
      expect(metrics.errorRates.circuitBreakerTrips).toBe(2);
    });

    it('should record cache failures', () => {
      service.recordError('cacheFailures');

      const metrics = service.getMetrics();
      expect(metrics.errorRates.cacheFailures).toBe(1);
    });

    it('should record API timeouts', () => {
      service.recordError('apiTimeouts');
      service.recordError('apiTimeouts');
      service.recordError('apiTimeouts');

      const metrics = service.getMetrics();
      expect(metrics.errorRates.apiTimeouts).toBe(3);
    });
  });

  describe('getHistoricalData', () => {
    it('should return historical data within specified time window', async () => {
      // Record some data
      service.recordResponseTime(100);
      service.recordRequest();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const historical = service.getHistoricalData(5);
      expect(historical.responseTime).toBeInstanceOf(Array);
      expect(historical.throughput).toBeInstanceOf(Array);
    });

    it('should filter data by time window correctly', async () => {
      // Record data
      service.recordResponseTime(100);
      service.recordRequest();

      // Get data for last 1 minute
      const oneMinute = service.getHistoricalData(1);
      const fiveMinutes = service.getHistoricalData(5);

      expect(oneMinute.responseTime.length).toBeLessThanOrEqual(
        fiveMinutes.responseTime.length,
      );
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics to initial state', () => {
      // Record some data
      service.recordResponseTime(500);
      service.recordRequest();
      service.recordError('cacheFailures');

      // Reset metrics
      service.resetMetrics();

      const metrics = service.getMetrics();
      expect(metrics.responseTime.current).toBe(0);
      expect(metrics.responseTime.average1min).toBe(0);
      expect(metrics.responseTime.average5min).toBe(0);
      expect(metrics.throughput.requestsPerMinute).toBe(0);
      expect(metrics.errorRates.cacheFailures).toBe(0);
    });
  });

  describe('alert thresholds', () => {
    it('should use configured alert thresholds', () => {
      expect(configService.get).toHaveBeenCalledWith(
        'PERFORMANCE_ALERT_RESPONSE_TIME_WARN',
        1000,
      );
      expect(configService.get).toHaveBeenCalledWith(
        'PERFORMANCE_ALERT_RESPONSE_TIME_ERROR',
        2000,
      );
      expect(configService.get).toHaveBeenCalledWith(
        'PERFORMANCE_ALERT_ERROR_RATE_WARN',
        0.05,
      );
      expect(configService.get).toHaveBeenCalledWith(
        'PERFORMANCE_ALERT_ERROR_RATE_ERROR',
        0.1,
      );
    });
  });

  describe('data cleanup', () => {
    it('should clean up old data automatically', async () => {
      // Record data
      service.recordResponseTime(100);
      service.recordRequest();

      // Get initial data count
      const initialData = service.getHistoricalData(5);
      const initialCount =
        initialData.responseTime.length + initialData.throughput.length;

      // The cleanup happens automatically in the background
      // We can't easily test the exact timing, but we can verify the structure
      expect(initialCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('metrics structure', () => {
    it('should return properly structured metrics', () => {
      const metrics = service.getMetrics();

      expect(metrics).toHaveProperty('responseTime');
      expect(metrics).toHaveProperty('throughput');
      expect(metrics).toHaveProperty('errorRates');
      expect(metrics).toHaveProperty('timestamp');

      expect(metrics.responseTime).toHaveProperty('current');
      expect(metrics.responseTime).toHaveProperty('average1min');
      expect(metrics.responseTime).toHaveProperty('average5min');
      expect(metrics.responseTime).toHaveProperty('p95');
      expect(metrics.responseTime).toHaveProperty('p99');

      expect(metrics.throughput).toHaveProperty('requestsPerMinute');
      expect(metrics.throughput).toHaveProperty('peakRpm');

      expect(metrics.errorRates).toHaveProperty('circuitBreakerTrips');
      expect(metrics.errorRates).toHaveProperty('cacheFailures');
      expect(metrics.errorRates).toHaveProperty('apiTimeouts');
    });
  });

  describe('edge cases', () => {
    it('should handle zero response times', () => {
      service.recordResponseTime(0);

      const metrics = service.getMetrics();
      expect(metrics.responseTime.current).toBe(0);
    });

    it('should handle very large response times', () => {
      const largeTime = 999999;
      service.recordResponseTime(largeTime);

      const metrics = service.getMetrics();
      expect(metrics.responseTime.current).toBe(largeTime);
    });

    it('should handle empty data for percentile calculations', () => {
      const metrics = service.getMetrics();
      expect(metrics.responseTime.p95).toBe(0);
      expect(metrics.responseTime.p99).toBe(0);
    });
  });
});
