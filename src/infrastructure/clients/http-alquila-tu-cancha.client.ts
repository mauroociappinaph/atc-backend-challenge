import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as moment from 'moment';

import { Club } from '../../domain/model/club';
import { Court } from '../../domain/model/court';
import { Slot } from '../../domain/model/slot';
import { AlquilaTuCanchaClient } from '../../domain/ports/aquila-tu-cancha.client';
import { CACHE_SERVICE, RATE_LIMITER_SERVICE } from '../../domain/tokens';
import { CacheService } from '../services/cache.service';
import { CircuitBreakerService } from '../services/circuit-breaker.service';
import { RateLimiterService } from '../services/rate-limiter.service';

@Injectable()
export class HTTPAlquilaTuCanchaClient implements AlquilaTuCanchaClient {
  private base_url: string;

  constructor(
    private httpService: HttpService,
    config: ConfigService,
    @Inject(CACHE_SERVICE) private cacheService: CacheService,
    @Inject(RATE_LIMITER_SERVICE) private rateLimiter: RateLimiterService,
    private circuitBreaker: CircuitBreakerService,
  ) {
    this.base_url = config.get<string>('ATC_BASE_URL', 'http://localhost:4000');
  }

  async getClubs(placeId: string): Promise<Club[]> {
    const cacheKey = `clubs:${placeId}`;

    // Check cache first
    const cachedClubs = await this.cacheService.get<Club[]>(cacheKey);
    if (cachedClubs) {
      return cachedClubs;
    }

    // Wait for rate limiter slot
    await this.rateLimiter.waitForSlot('http-client');

    // Execute with circuit breaker
    const clubs = await this.circuitBreaker.execute(
      async () => {
        const response = await this.httpService.axiosRef.get('clubs', {
          baseURL: this.base_url,
          params: { placeId },
        });
        return response.data;
      },
      async () => {
        // Fallback to cached data (even if expired)
        return cachedClubs || [];
      },
    );

    // Store in cache with 5 minute TTL
    if (clubs && clubs.length > 0) {
      await this.cacheService.set(cacheKey, clubs, 300);
    }

    return clubs;
  }

  async getCourts(clubId: number): Promise<Court[]> {
    const cacheKey = `courts:${clubId}`;

    // Check cache first
    const cachedCourts = await this.cacheService.get<Court[]>(cacheKey);
    if (cachedCourts) {
      return cachedCourts;
    }

    // Wait for rate limiter slot
    await this.rateLimiter.waitForSlot('http-client');

    // Execute with circuit breaker
    const courts = await this.circuitBreaker.execute(
      async () => {
        const response = await this.httpService.axiosRef.get(
          `/clubs/${clubId}/courts`,
          {
            baseURL: this.base_url,
          },
        );
        return response.data;
      },
      async () => {
        // Fallback to cached data (even if expired)
        return cachedCourts || [];
      },
    );

    // Store in cache with 10 minute TTL (courts change less frequently)
    if (courts && courts.length > 0) {
      await this.cacheService.set(cacheKey, courts, 600);
    }

    return courts;
  }

  async getAvailableSlots(
    clubId: number,
    courtId: number,
    date: Date,
  ): Promise<Slot[]> {
    const dateStr = moment(date).format('YYYY-MM-DD');
    const cacheKey = `slots:${clubId}:${courtId}:${dateStr}`;

    // Check cache first
    const cachedSlots = await this.cacheService.get<Slot[]>(cacheKey);
    if (cachedSlots) {
      return cachedSlots;
    }

    // Wait for rate limiter slot
    await this.rateLimiter.waitForSlot('http-client');

    // Execute with circuit breaker
    const slots = await this.circuitBreaker.execute(
      async () => {
        const response = await this.httpService.axiosRef.get(
          `/clubs/${clubId}/courts/${courtId}/slots`,
          {
            baseURL: this.base_url,
            params: { date: dateStr },
          },
        );
        return response.data;
      },
      async () => {
        // Fallback to cached data (even if expired)
        return cachedSlots || [];
      },
    );

    // Store in cache with 5 minute TTL (slots change frequently)
    if (slots && slots.length > 0) {
      await this.cacheService.set(cacheKey, slots, 300);
    }

    return slots;
  }
}
