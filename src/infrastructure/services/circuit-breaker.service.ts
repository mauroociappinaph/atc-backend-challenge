import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
}

export interface CircuitBreakerMetrics {
  failures: number;
  successes: number;
  lastFailureTime: number;
  state: CircuitBreakerState;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly config: CircuitBreakerConfig;
  private metrics: CircuitBreakerMetrics;

  constructor(private configService: ConfigService) {
    this.config = {
      failureThreshold: this.configService.get<number>(
        'CIRCUIT_BREAKER_FAILURE_THRESHOLD',
        5,
      ),
      recoveryTimeout: this.configService.get<number>(
        'CIRCUIT_BREAKER_RECOVERY_TIMEOUT',
        60000,
      ), // 1 minute
      monitoringPeriod: this.configService.get<number>(
        'CIRCUIT_BREAKER_MONITORING_PERIOD',
        60000,
      ), // 1 minute
    };

    this.metrics = {
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      state: CircuitBreakerState.CLOSED,
    };

    this.logger.log(
      `Circuit breaker initialized with config: ${JSON.stringify(this.config)}`,
    );
  }

  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    const currentState = this.getState();

    switch (currentState) {
      case CircuitBreakerState.CLOSED:
        return this.executeInClosedState(operation, fallback);

      case CircuitBreakerState.OPEN:
        return this.executeInOpenState(operation, fallback);

      case CircuitBreakerState.HALF_OPEN:
        return this.executeInHalfOpenState(operation, fallback);

      default:
        throw new Error(`Unknown circuit breaker state: ${currentState}`);
    }
  }

  getState(): CircuitBreakerState {
    const now = Date.now();

    // Check if we should transition from OPEN to HALF_OPEN
    if (this.metrics.state === CircuitBreakerState.OPEN) {
      const timeSinceLastFailure = now - this.metrics.lastFailureTime;
      if (timeSinceLastFailure >= this.config.recoveryTimeout) {
        this.transitionTo(CircuitBreakerState.HALF_OPEN);
      }
    }

    return this.metrics.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    return { ...this.metrics };
  }

  private async executeInClosedState<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();

      // If we've exceeded the failure threshold, open the circuit
      if (this.metrics.failures >= this.config.failureThreshold) {
        this.transitionTo(CircuitBreakerState.OPEN);
      }

      // Try fallback if available, otherwise rethrow
      if (fallback) {
        this.logger.warn(
          'Operation failed in CLOSED state, executing fallback',
        );
        return await fallback();
      }

      throw error;
    }
  }

  private async executeInOpenState<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    this.logger.debug('Circuit breaker is OPEN, skipping operation');

    if (fallback) {
      return await fallback();
    }

    throw new Error('Circuit breaker is OPEN and no fallback provided');
  }

  private async executeInHalfOpenState<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation();
      this.onSuccess();

      // If successful in HALF_OPEN, transition back to CLOSED
      this.transitionTo(CircuitBreakerState.CLOSED);
      this.resetMetrics();

      return result;
    } catch (error) {
      this.onFailure();

      // If failed in HALF_OPEN, go back to OPEN
      this.transitionTo(CircuitBreakerState.OPEN);

      // Try fallback if available, otherwise rethrow
      if (fallback) {
        this.logger.warn(
          'Operation failed in HALF_OPEN state, executing fallback',
        );
        return await fallback();
      }

      throw error;
    }
  }

  private onSuccess(): void {
    this.metrics.successes++;
    this.logger.debug(
      `Circuit breaker success count: ${this.metrics.successes}`,
    );
  }

  private onFailure(): void {
    this.metrics.failures++;
    this.metrics.lastFailureTime = Date.now();
    this.logger.warn(`Circuit breaker failure count: ${this.metrics.failures}`);
  }

  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.metrics.state;
    this.metrics.state = newState;

    this.logger.log(
      `Circuit breaker state transition: ${oldState} -> ${newState}`,
    );

    // Reset failure count when transitioning to HALF_OPEN
    if (newState === CircuitBreakerState.HALF_OPEN) {
      this.metrics.failures = 0;
    }
  }

  private resetMetrics(): void {
    this.metrics.failures = 0;
    this.metrics.successes = 0;
    this.logger.debug('Circuit breaker metrics reset');
  }
}
