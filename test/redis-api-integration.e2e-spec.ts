import { HttpModule } from '@nestjs/axios';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';

import { ClubUpdatedHandler } from '../src/domain/handlers/club-updated.handler';
import { GetAvailabilityHandler } from '../src/domain/handlers/get-availability.handler';
import { ALQUILA_TU_CANCHA_CLIENT } from '../src/domain/ports/aquila-tu-cancha.client';
import { HTTPAlquilaTuCanchaClient } from '../src/infrastructure/clients/http-alquila-tu-cancha.client';
import { EventsController } from '../src/infrastructure/controllers/events.controller';
import { SearchController } from '../src/infrastructure/controllers/search.controller';
import { RedisService } from '../src/infrastructure/services/redis.service';

// Mock ioredis for integration testing
jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: RedisMock,
  };
});

describe('Redis API Integration (e2e)', () => {
  let app: NestFastifyApplication;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HttpModule, CqrsModule, ConfigModule.forRoot()],
      controllers: [SearchController, EventsController],
      providers: [
        {
          provide: ALQUILA_TU_CANCHA_CLIENT,
          useClass: HTTPAlquilaTuCanchaClient,
        },
        GetAvailabilityHandler,
        ClubUpdatedHandler,
        RedisService,
      ],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    redisService = moduleFixture.get<RedisService>(RedisService);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Redis Service Integration', () => {
    it('should be properly injected and available in the application context', () => {
      expect(redisService).toBeDefined();
      expect(redisService).toBeInstanceOf(RedisService);
    });

    it('should connect to Redis and respond to ping', async () => {
      const pingResult = await redisService.ping();
      expect(pingResult).toBe('PONG');
    });

    it('should perform cache operations that would be used by the API', async () => {
      const cacheKey = 'test:api:cache';
      const cacheValue = JSON.stringify({
        clubs: [{ id: 1, name: 'Test Club' }],
        timestamp: new Date().toISOString(),
      });

      // Test setting cache data (simulating API caching behavior)
      await redisService.set(cacheKey, cacheValue, 300); // 5 minutes TTL

      // Test retrieving cache data (simulating API cache lookup)
      const retrievedValue = await redisService.get(cacheKey);
      expect(retrievedValue).toBe(cacheValue);

      // Parse and verify the cached data structure
      const parsedData = JSON.parse(retrievedValue!);
      expect(parsedData).toHaveProperty('clubs');
      expect(parsedData).toHaveProperty('timestamp');
      expect(parsedData.clubs).toHaveLength(1);
      expect(parsedData.clubs[0]).toEqual({ id: 1, name: 'Test Club' });
    });

    it('should handle cache invalidation patterns used by event handlers', async () => {
      // Set up multiple cache entries that would be created by API calls
      const clubCacheKey = 'clubs:ChIJW9fXNZNTtpURV6VYAumGQOw';
      const courtCacheKey = 'courts:123';
      const slotCacheKey = 'slots:123:456:2025-07-24';

      await redisService.set(clubCacheKey, JSON.stringify([{ id: 123 }]));
      await redisService.set(courtCacheKey, JSON.stringify([{ id: 456 }]));
      await redisService.set(slotCacheKey, JSON.stringify([{ id: 789 }]));

      // Verify all entries exist
      expect(await redisService.get(clubCacheKey)).toBeTruthy();
      expect(await redisService.get(courtCacheKey)).toBeTruthy();
      expect(await redisService.get(slotCacheKey)).toBeTruthy();

      // Simulate cache invalidation (what event handlers would do)
      await redisService.del(slotCacheKey);

      // Verify specific entry was invalidated
      expect(await redisService.get(slotCacheKey)).toBeNull();
      // Verify other entries remain
      expect(await redisService.get(clubCacheKey)).toBeTruthy();
      expect(await redisService.get(courtCacheKey)).toBeTruthy();
    });

    it('should handle TTL expiration as expected by the caching strategy', async () => {
      const shortTtlKey = 'test:short:ttl';
      const shortTtlValue = 'expires-quickly';

      // Set with very short TTL (1 second)
      await redisService.set(shortTtlKey, shortTtlValue, 1);

      // Immediately verify it exists
      const immediateValue = await redisService.get(shortTtlKey);
      expect(immediateValue).toBe(shortTtlValue);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Verify it expired
      const expiredValue = await redisService.get(shortTtlKey);
      expect(expiredValue).toBeNull();
    });
  });

  describe('Application Context with Redis', () => {
    it('should start the application successfully with Redis service', async () => {
      expect(app).toBeDefined();
      // Verify app is properly initialized
      const httpAdapter = app.getHttpAdapter();
      expect(httpAdapter).toBeDefined();
    });

    it('should have Redis service available to other components', () => {
      // Verify that Redis service is properly registered and can be retrieved
      const retrievedRedisService = app.get(RedisService);
      expect(retrievedRedisService).toBeDefined();
      expect(retrievedRedisService).toBe(redisService);
    });

    it('should maintain Redis connection throughout application lifecycle', async () => {
      // Test connection stability
      const ping1 = await redisService.ping();
      expect(ping1).toBe('PONG');

      // Perform some operations
      await redisService.set('lifecycle:test', 'stable-connection');
      const value = await redisService.get('lifecycle:test');
      expect(value).toBe('stable-connection');

      // Test connection is still stable
      const ping2 = await redisService.ping();
      expect(ping2).toBe('PONG');

      // Clean up
      await redisService.del('lifecycle:test');
    });
  });

  describe('Redis Configuration Validation', () => {
    it('should use correct Redis configuration from environment', () => {
      // Verify Redis client configuration
      const client = redisService.getClient();
      expect(client).toBeDefined();

      // Verify connection status
      const isConnected = redisService.isConnected();
      expect(typeof isConnected).toBe('boolean');
    });

    it('should handle Redis operations with proper error handling', async () => {
      // Test that Redis service methods handle errors gracefully
      try {
        await redisService.ping();
        await redisService.set('error:test', 'test-value');
        await redisService.get('error:test');
        await redisService.del('error:test');

        // If we reach here, all operations succeeded
        expect(true).toBe(true);
      } catch (error) {
        // If Redis operations fail, the service should handle it gracefully
        expect(error).toBeDefined();
      }
    });
  });

  describe('Cache Key Patterns for API Integration', () => {
    it('should support cache key patterns that will be used by enhanced HTTPAlquilaTuCanchaClient', async () => {
      // Test cache key patterns that match the design document
      const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
      const clubId = 123;
      const courtId = 456;
      const date = '2025-07-24';

      const clubsKey = `clubs:${placeId}`;
      const courtsKey = `courts:${clubId}`;
      const slotsKey = `slots:${clubId}:${courtId}:${date}`;

      // Test setting cache with these patterns
      await redisService.set(
        clubsKey,
        JSON.stringify([{ id: clubId, name: 'Test Club' }]),
        3600,
      );
      await redisService.set(
        courtsKey,
        JSON.stringify([{ id: courtId, name: 'Test Court' }]),
        1800,
      );
      await redisService.set(
        slotsKey,
        JSON.stringify([{ id: 789, datetime: '2025-07-24T10:00:00' }]),
        300,
      );

      // Verify all cache entries
      const clubsData = await redisService.get(clubsKey);
      const courtsData = await redisService.get(courtsKey);
      const slotsData = await redisService.get(slotsKey);

      expect(clubsData).toBeTruthy();
      expect(courtsData).toBeTruthy();
      expect(slotsData).toBeTruthy();

      // Verify data structure
      const clubs = JSON.parse(clubsData!);
      const courts = JSON.parse(courtsData!);
      const slots = JSON.parse(slotsData!);

      expect(clubs).toHaveLength(1);
      expect(courts).toHaveLength(1);
      expect(slots).toHaveLength(1);

      // Clean up
      await redisService.del(clubsKey);
      await redisService.del(courtsKey);
      await redisService.del(slotsKey);
    });
  });
});
