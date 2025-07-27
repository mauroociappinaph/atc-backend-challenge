import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import {
  CircuitBreakerService,
  CircuitBreakerState,
} from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config = {
        CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
        CIRCUIT_BREAKER_RECOVERY_TIMEOUT: 1000,
        CIRCUIT_BREAKER_MONITORING_PERIOD: 1000,
      };
      return config[key] || defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitBreakerService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with CLOSED state', () => {
      expect(service.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should initialize with zero metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.failures).toBe(0);
      expect(metrics.successes).toBe(0);
      expect(metrics.lastFailureTime).toBe(0);
    });
  });

  describe('CLOSED state behavior', () => {
    it('should execute operation successfully in CLOSED state', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await service.execute(mockOperation);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(service.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should increment success count on successful operation', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      await service.execute(mockOperation);

      const metrics = service.getMetrics();
      expect(metrics.successes).toBe(1);
      expect(metrics.failures).toBe(0);
    });

    it('should increment failure count on failed operation', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback');

      await service.execute(mockOperation, mockFallback);

      const metrics = service.getMetrics();
      expect(metrics.failures).toBe(1);
      expect(metrics.successes).toBe(0);
    });

    it('should transition to OPEN state after failure threshold is reached', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback');

      // Execute 3 failed operations (threshold is 3)
      await service.execute(mockOperation, mockFallback);
      await service.execute(mockOperation, mockFallback);
      await service.execute(mockOperation, mockFallback);

      expect(service.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should execute fallback when operation fails', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback result');

      const result = await service.execute(mockOperation, mockFallback);

      expect(result).toBe('fallback result');
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });

    it('should throw error when operation fails and no fallback provided', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));

      await expect(service.execute(mockOperation)).rejects.toThrow(
        'test error',
      );
    });
  });

  describe('OPEN state behavior', () => {
    beforeEach(async () => {
      // Force circuit breaker to OPEN state
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback');

      // Execute 3 failed operations to open the circuit
      await service.execute(mockOperation, mockFallback);
      await service.execute(mockOperation, mockFallback);
      await service.execute(mockOperation, mockFallback);
    });

    it('should not execute operation in OPEN state', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      const mockFallback = jest.fn().mockResolvedValue('fallback');

      await service.execute(mockOperation, mockFallback);

      expect(mockOperation).not.toHaveBeenCalled();
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });

    it('should execute fallback in OPEN state', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      const mockFallback = jest.fn().mockResolvedValue('fallback result');

      const result = await service.execute(mockOperation, mockFallback);

      expect(result).toBe('fallback result');
    });

    it('should throw error in OPEN state when no fallback provided', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      await expect(service.execute(mockOperation)).rejects.toThrow(
        'Circuit breaker is OPEN and no fallback provided',
      );
    });

    it('should transition to HALF_OPEN after recovery timeout', async () => {
      // Wait for recovery timeout (1 second in test config)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(service.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });
  });

  describe('HALF_OPEN state behavior', () => {
    beforeEach(async () => {
      // Force circuit breaker to OPEN state
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback');

      // Execute 3 failed operations to open the circuit
      await service.execute(mockOperation, mockFallback);
      await service.execute(mockOperation, mockFallback);
      await service.execute(mockOperation, mockFallback);

      // Wait for recovery timeout to transition to HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    it('should execute operation in HALF_OPEN state', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await service.execute(mockOperation);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should transition to CLOSED on successful operation in HALF_OPEN', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      await service.execute(mockOperation);

      expect(service.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should reset metrics when transitioning from HALF_OPEN to CLOSED', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      await service.execute(mockOperation);

      const metrics = service.getMetrics();
      expect(metrics.failures).toBe(0);
      expect(metrics.successes).toBe(1);
    });

    it('should transition back to OPEN on failed operation in HALF_OPEN', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback');

      await service.execute(mockOperation, mockFallback);

      expect(service.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should execute fallback when operation fails in HALF_OPEN', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback result');

      const result = await service.execute(mockOperation, mockFallback);

      expect(result).toBe('fallback result');
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('metrics tracking', () => {
    it('should track failure timestamps', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback');

      const beforeTime = Date.now();
      await service.execute(mockOperation, mockFallback);
      const afterTime = Date.now();

      const metrics = service.getMetrics();
      expect(metrics.lastFailureTime).toBeGreaterThanOrEqual(beforeTime);
      expect(metrics.lastFailureTime).toBeLessThanOrEqual(afterTime);
    });

    it('should provide accurate metrics snapshot', async () => {
      const mockSuccessOperation = jest.fn().mockResolvedValue('success');
      const mockFailOperation = jest
        .fn()
        .mockRejectedValue(new Error('test error'));
      const mockFallback = jest.fn().mockResolvedValue('fallback');

      await service.execute(mockSuccessOperation);
      await service.execute(mockSuccessOperation);
      await service.execute(mockFailOperation, mockFallback);

      const metrics = service.getMetrics();
      expect(metrics.successes).toBe(2);
      expect(metrics.failures).toBe(1);
      expect(metrics.state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('configuration', () => {
    it('should use custom configuration values', () => {
      expect(configService.get).toHaveBeenCalledWith(
        'CIRCUIT_BREAKER_FAILURE_THRESHOLD',
        5,
      );
      expect(configService.get).toHaveBeenCalledWith(
        'CIRCUIT_BREAKER_RECOVERY_TIMEOUT',
        60000,
      );
      expect(configService.get).toHaveBeenCalledWith(
        'CIRCUIT_BREAKER_MONITORING_PERIOD',
        60000,
      );
    });
  });

  describe('error handling', () => {
    it('should handle unknown state gracefully', async () => {
      // Force an invalid state (this is a theoretical test)
      (service as any).metrics.state = 'INVALID_STATE';

      const mockOperation = jest.fn().mockResolvedValue('success');

      await expect(service.execute(mockOperation)).rejects.toThrow(
        'Unknown circuit breaker state: INVALID_STATE',
      );
    });
  });
});
