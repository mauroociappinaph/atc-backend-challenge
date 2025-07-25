import { ConfigService } from '@nestjs/config';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
}

export const getCircuitBreakerConfig = (
  configService: ConfigService,
): CircuitBreakerConfig => {
  return {
    failureThreshold: configService.get<number>(
      'CIRCUIT_BREAKER_FAILURE_THRESHOLD',
      5,
    ),
    recoveryTimeout: configService.get<number>(
      'CIRCUIT_BREAKER_RECOVERY_TIMEOUT',
      60000,
    ), // 1 minute
    monitoringPeriod: configService.get<number>(
      'CIRCUIT_BREAKER_MONITORING_PERIOD',
      60000,
    ), // 1 minute
  };
};

export const CIRCUIT_BREAKER_CONFIG = 'CIRCUIT_BREAKER_CONFIG';
