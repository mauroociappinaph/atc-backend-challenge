import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PerformanceMetrics {
  responseTime: {
    current: number;
    average1min: number;
    average5min: number;
    p95: number;
    p99: number;
  };
  throughput: {
    requestsPerMinute: number;
    peakRpm: number;
  };
  errorRates: {
    circuitBreakerTrips: number;
    cacheFailures: number;
    apiTimeouts: number;
  };
  timestamp: number;
}

export interface AlertThresholds {
  responseTimeWarn: number;
  responseTimeError: number;
  errorRateWarn: number;
  errorRateError: number;
}

interface TimeSeriesData {
  timestamp: number;
  value: number;
}

interface SlidingWindow {
  data: TimeSeriesData[];
  maxSize: number;
}

@Injectable()
export class PerformanceMetricsService {
  private readonly logger = new Logger(PerformanceMetricsService.name);

  private readonly responseTimeWindow: SlidingWindow = {
    data: [],
    maxSize: 300, // 5 minutes of data (1 entry per second)
  };

  private readonly throughputWindow: SlidingWindow = {
    data: [],
    maxSize: 60, // 1 hour of data (1 entry per minute)
  };

  private errorCounts = {
    circuitBreakerTrips: 0,
    cacheFailures: 0,
    apiTimeouts: 0,
  };

  private currentMetrics: PerformanceMetrics = {
    responseTime: {
      current: 0,
      average1min: 0,
      average5min: 0,
      p95: 0,
      p99: 0,
    },
    throughput: {
      requestsPerMinute: 0,
      peakRpm: 0,
    },
    errorRates: {
      circuitBreakerTrips: 0,
      cacheFailures: 0,
      apiTimeouts: 0,
    },
    timestamp: Date.now(),
  };

  private readonly alertThresholds: AlertThresholds;

  constructor(private readonly configService: ConfigService) {
    this.alertThresholds = {
      responseTimeWarn: this.configService.get<number>(
        'PERFORMANCE_ALERT_RESPONSE_TIME_WARN',
        1000,
      ),
      responseTimeError: this.configService.get<number>(
        'PERFORMANCE_ALERT_RESPONSE_TIME_ERROR',
        2000,
      ),
      errorRateWarn: this.configService.get<number>(
        'PERFORMANCE_ALERT_ERROR_RATE_WARN',
        0.05,
      ),
      errorRateError: this.configService.get<number>(
        'PERFORMANCE_ALERT_ERROR_RATE_ERROR',
        0.1,
      ),
    };

    // Initialize periodic calculations
    this.startPeriodicCalculations();
  }

  recordResponseTime(responseTime: number): void {
    const now = Date.now();

    // Add to sliding window
    this.responseTimeWindow.data.push({ timestamp: now, value: responseTime });
    this.cleanupOldData(this.responseTimeWindow, 300000); // 5 minutes

    // Update current metrics
    this.currentMetrics.responseTime.current = responseTime;
    this.currentMetrics.timestamp = now;

    // Check for alerts
    this.checkResponseTimeAlerts(responseTime);

    // Recalculate aggregated metrics
    this.calculateResponseTimeMetrics();
  }

  recordRequest(): void {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000) * 60000;

    // Find or create entry for current minute
    let minuteEntry = this.throughputWindow.data.find(
      (entry) => entry.timestamp === currentMinute,
    );

    if (!minuteEntry) {
      minuteEntry = { timestamp: currentMinute, value: 0 };
      this.throughputWindow.data.push(minuteEntry);
      this.cleanupOldData(this.throughputWindow, 3600000); // 1 hour
    }

    minuteEntry.value++;

    // Update throughput metrics
    this.calculateThroughputMetrics();
  }

  recordError(
    errorType: 'circuitBreakerTrips' | 'cacheFailures' | 'apiTimeouts',
  ): void {
    this.errorCounts[errorType]++;
    this.currentMetrics.errorRates[errorType] = this.errorCounts[errorType];

    // Check for error rate alerts
    this.checkErrorRateAlerts();
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.currentMetrics };
  }

  getHistoricalData(minutes = 5): {
    responseTime: TimeSeriesData[];
    throughput: TimeSeriesData[];
  } {
    const cutoff = Date.now() - minutes * 60000;

    return {
      responseTime: this.responseTimeWindow.data.filter(
        (entry) => entry.timestamp >= cutoff,
      ),
      throughput: this.throughputWindow.data.filter(
        (entry) => entry.timestamp >= cutoff,
      ),
    };
  }

  resetMetrics(): void {
    this.responseTimeWindow.data = [];
    this.throughputWindow.data = [];
    this.errorCounts = {
      circuitBreakerTrips: 0,
      cacheFailures: 0,
      apiTimeouts: 0,
    };

    this.currentMetrics = {
      responseTime: {
        current: 0,
        average1min: 0,
        average5min: 0,
        p95: 0,
        p99: 0,
      },
      throughput: {
        requestsPerMinute: 0,
        peakRpm: 0,
      },
      errorRates: {
        circuitBreakerTrips: 0,
        cacheFailures: 0,
        apiTimeouts: 0,
      },
      timestamp: Date.now(),
    };
  }

  private startPeriodicCalculations(): void {
    // Recalculate metrics every 10 seconds
    setInterval(() => {
      this.calculateResponseTimeMetrics();
      this.calculateThroughputMetrics();
    }, 10000);
  }

  private calculateResponseTimeMetrics(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const fiveMinutesAgo = now - 300000;

    const oneMinuteData = this.responseTimeWindow.data.filter(
      (entry) => entry.timestamp >= oneMinuteAgo,
    );
    const fiveMinuteData = this.responseTimeWindow.data.filter(
      (entry) => entry.timestamp >= fiveMinutesAgo,
    );

    // Calculate averages
    this.currentMetrics.responseTime.average1min =
      oneMinuteData.length > 0
        ? oneMinuteData.reduce((sum, entry) => sum + entry.value, 0) /
          oneMinuteData.length
        : 0;

    this.currentMetrics.responseTime.average5min =
      fiveMinuteData.length > 0
        ? fiveMinuteData.reduce((sum, entry) => sum + entry.value, 0) /
          fiveMinuteData.length
        : 0;

    // Calculate percentiles
    if (fiveMinuteData.length > 0) {
      const sortedValues = fiveMinuteData
        .map((entry) => entry.value)
        .sort((a, b) => a - b);
      this.currentMetrics.responseTime.p95 = this.calculatePercentile(
        sortedValues,
        95,
      );
      this.currentMetrics.responseTime.p99 = this.calculatePercentile(
        sortedValues,
        99,
      );
    }
  }

  private calculateThroughputMetrics(): void {
    if (this.throughputWindow.data.length === 0) return;

    // Current RPM is the most recent minute's count
    const latestEntry =
      this.throughputWindow.data[this.throughputWindow.data.length - 1];
    this.currentMetrics.throughput.requestsPerMinute = latestEntry?.value || 0;

    // Peak RPM is the highest value in the window
    this.currentMetrics.throughput.peakRpm = Math.max(
      ...this.throughputWindow.data.map((entry) => entry.value),
    );
  }

  private calculatePercentile(
    sortedValues: number[],
    percentile: number,
  ): number {
    if (sortedValues.length === 0) return 0;

    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  private cleanupOldData(window: SlidingWindow, maxAge: number): void {
    const cutoff = Date.now() - maxAge;
    window.data = window.data.filter((entry) => entry.timestamp >= cutoff);
  }

  private checkResponseTimeAlerts(responseTime: number): void {
    if (responseTime >= this.alertThresholds.responseTimeError) {
      this.logger.error(
        `CRITICAL: Response time ${responseTime}ms exceeds error threshold ${this.alertThresholds.responseTimeError}ms`,
      );
    } else if (responseTime >= this.alertThresholds.responseTimeWarn) {
      this.logger.warn(
        `WARNING: Response time ${responseTime}ms exceeds warning threshold ${this.alertThresholds.responseTimeWarn}ms`,
      );
    }
  }

  private checkErrorRateAlerts(): void {
    const totalRequests = this.throughputWindow.data.reduce(
      (sum, entry) => sum + entry.value,
      0,
    );
    if (totalRequests === 0) return;

    const totalErrors = Object.values(this.errorCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    const errorRate = totalErrors / totalRequests;

    if (errorRate >= this.alertThresholds.errorRateError) {
      this.logger.error(
        `CRITICAL: Error rate ${(errorRate * 100).toFixed(
          2,
        )}% exceeds error threshold ${(
          this.alertThresholds.errorRateError * 100
        ).toFixed(2)}%`,
      );
    } else if (errorRate >= this.alertThresholds.errorRateWarn) {
      this.logger.warn(
        `WARNING: Error rate ${(errorRate * 100).toFixed(
          2,
        )}% exceeds warning threshold ${(
          this.alertThresholds.errorRateWarn * 100
        ).toFixed(2)}%`,
      );
    }
  }
}
