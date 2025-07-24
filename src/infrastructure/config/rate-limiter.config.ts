export interface RateLimiterConfig {
  /** Requests per minute limit */
  rpm: number;
  /** TTL for rate limit buckets in Redis (seconds) */
  bucketTtlSeconds: number;
  /** Maximum time to wait for a slot (milliseconds) */
  maxWaitTimeMs: number;
  /** Interval between rate limit checks (milliseconds) */
  checkIntervalMs: number;
  /** Rate limiting strategy to use */
  strategy: 'token_bucket' | 'sliding_window';
}

export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  rpm: 60,
  bucketTtlSeconds: 120,
  maxWaitTimeMs: 60000,
  checkIntervalMs: 100,
  strategy: 'token_bucket',
};

export const RATE_LIMITER_CONFIG_KEYS = {
  RPM: 'RATE_LIMIT_RPM',
  BUCKET_TTL_SECONDS: 'RATE_LIMIT_BUCKET_TTL_SECONDS',
  MAX_WAIT_TIME_MS: 'RATE_LIMIT_MAX_WAIT_TIME_MS',
  CHECK_INTERVAL_MS: 'RATE_LIMIT_CHECK_INTERVAL_MS',
  STRATEGY: 'RATE_LIMIT_STRATEGY',
} as const;
