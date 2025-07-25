export interface RateLimitingStrategy {
  canConsume(
    currentState: RateLimitState,
    now: number,
    capacity: number,
    refillRate: number,
  ): { allowed: boolean; newState: RateLimitState };
}

export interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

export class TokenBucketStrategy implements RateLimitingStrategy {
  canConsume(
    currentState: RateLimitState,
    now: number,
    capacity: number,
    refillRate: number,
  ): { allowed: boolean; newState: RateLimitState } {
    const timePassed = now - currentState.lastRefill;
    const tokensToAdd = (timePassed / 1000) * refillRate;

    const availableTokens = Math.min(
      capacity,
      currentState.tokens + tokensToAdd,
    );

    if (availableTokens >= 1) {
      return {
        allowed: true,
        newState: {
          tokens: availableTokens - 1,
          lastRefill: now,
        },
      };
    }

    return {
      allowed: false,
      newState: {
        tokens: availableTokens,
        lastRefill: now,
      },
    };
  }
}

export class SlidingWindowStrategy implements RateLimitingStrategy {
  canConsume(
    currentState: RateLimitState,
    now: number,
    capacity: number,
    refillRate: number,
  ): { allowed: boolean; newState: RateLimitState } {
    // Implementation for sliding window algorithm
    // This is a placeholder for future enhancement
    const tokenBucket = new TokenBucketStrategy();
    return tokenBucket.canConsume(currentState, now, capacity, refillRate);
  }
}
