import { INestApplication } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { ClubUpdatedEvent } from '../src/domain/events/club-updated.event';
import { CourtUpdatedEvent } from '../src/domain/events/court-updated.event';
import { SlotBookedEvent } from '../src/domain/events/slot-booked.event';
import { SlotAvailableEvent } from '../src/domain/events/slot-cancelled.event';
import {
  CACHE_SERVICE,
  CacheService,
} from '../src/infrastructure/services/cache.service';
import { RedisService } from '../src/infrastructure/services/redis.service';

describe('Event-Driven Cache Invalidation (e2e)', () => {
  let app: INestApplication;
  let eventBus: EventBus;
  let cacheService: CacheService;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    eventBus = moduleFixture.get<EventBus>(EventBus);
    cacheService = moduleFixture.get<CacheService>(CACHE_SERVICE);
    redisService = moduleFixture.get<RedisService>(RedisService);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Ensure Redis is connected
    await redisService.onModuleInit();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear all cache before each test
    if (redisService.isConnected()) {
      const client = redisService.getClient();
      await client.flushall();
    }
  });

  describe('ClubUpdatedHandler Cache Invalidation', () => {
    it('should invalidate club cache when club is updated', async () => {
      const clubId = 123;
      const placeId = 'test-place-id';

      // Pre-populate cache with club data
      const mockClubData = [{ id: clubId, name: 'Test Club', placeId }];
      await cacheService.set(`clubs:${placeId}`, mockClubData, 300);

      // Verify cache is populated
      const cachedData = await cacheService.get(`clubs:${placeId}`);
      expect(cachedData).toEqual(mockClubData);

      // Publish club updated event
      const event = new ClubUpdatedEvent(clubId, ['attributes']);
      eventBus.publish(event);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify cache is invalidated
      const invalidatedData = await cacheService.get(`clubs:${placeId}`);
      expect(invalidatedData).toBeNull();
    });

    it('should invalidate slot caches when openhours field is updated', async () => {
      const clubId = 123;
      const courtId = 456;
      const date = '2024-01-01';

      // Pre-populate cache with slot data
      const mockSlotData = [{ id: 1, start: '09:00', end: '10:00' }];
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        mockSlotData,
        300,
      );

      // Verify cache is populated
      const cachedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(cachedSlots).toEqual(mockSlotData);

      // Publish club updated event with openhours change
      const event = new ClubUpdatedEvent(clubId, ['openhours']);
      eventBus.publish(event);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify slot cache is invalidated
      const invalidatedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(invalidatedSlots).toBeNull();
    });

    it('should not invalidate slot caches when non-openhours fields are updated', async () => {
      const clubId = 123;
      const courtId = 456;
      const date = '2024-01-01';

      // Pre-populate cache with slot data
      const mockSlotData = [{ id: 1, start: '09:00', end: '10:00' }];
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        mockSlotData,
        300,
      );

      // Verify cache is populated
      const cachedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(cachedSlots).toEqual(mockSlotData);

      // Publish club updated event with non-openhours change
      const event = new ClubUpdatedEvent(clubId, ['logo_url']);
      eventBus.publish(event);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify slot cache is NOT invalidated
      const stillCachedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(stillCachedSlots).toEqual(mockSlotData);
    });
  });

  describe('SlotBookedHandler Cache Invalidation', () => {
    it('should invalidate slot cache when slot is booked', async () => {
      const clubId = 123;
      const courtId = 456;
      const slotDatetime = '2024-01-01T09:00:00';
      const date = '2024-01-01';

      // Pre-populate cache with slot data
      const mockSlotData = [
        { id: 1, start: '09:00', end: '10:00', datetime: slotDatetime },
        {
          id: 2,
          start: '10:00',
          end: '11:00',
          datetime: '2024-01-01T10:00:00',
        },
      ];
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        mockSlotData,
        300,
      );

      // Verify cache is populated
      const cachedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(cachedSlots).toEqual(mockSlotData);

      // Publish slot booked event
      const slot = {
        price: 100,
        duration: 60,
        datetime: slotDatetime,
        start: '09:00',
        end: '10:00',
        _priority: 1,
      };
      const event = new SlotBookedEvent(clubId, courtId, slot);
      eventBus.publish(event);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify slot cache is invalidated
      const invalidatedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(invalidatedSlots).toBeNull();
    });

    it('should handle slot booking events with different date formats', async () => {
      const clubId = 123;
      const courtId = 456;
      const slotDatetime = '2024-01-01 09:00:00'; // Different format
      const date = '2024-01-01';

      // Pre-populate cache
      const mockSlotData = [{ id: 1, start: '09:00', end: '10:00' }];
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        mockSlotData,
        300,
      );

      // Publish event
      const slot = {
        price: 100,
        duration: 60,
        datetime: slotDatetime,
        start: '09:00',
        end: '10:00',
        _priority: 1,
      };
      const event = new SlotBookedEvent(clubId, courtId, slot);
      eventBus.publish(event);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify cache is invalidated
      const invalidatedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(invalidatedSlots).toBeNull();
    });
  });

  describe('SlotAvailableHandler Cache Invalidation', () => {
    it('should invalidate slot cache when slot becomes available', async () => {
      const clubId = 123;
      const courtId = 456;
      const slotDatetime = '2024-01-01T09:00:00';
      const date = '2024-01-01';

      // Pre-populate cache with slot data
      const mockSlotData = [
        { id: 1, start: '09:00', end: '10:00', datetime: slotDatetime },
      ];
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        mockSlotData,
        300,
      );

      // Verify cache is populated
      const cachedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(cachedSlots).toEqual(mockSlotData);

      // Publish slot available event
      const slot = {
        price: 100,
        duration: 60,
        datetime: slotDatetime,
        start: '09:00',
        end: '10:00',
        _priority: 1,
      };
      const event = new SlotAvailableEvent(clubId, courtId, slot);
      eventBus.publish(event);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify slot cache is invalidated
      const invalidatedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(invalidatedSlots).toBeNull();
    });
  });

  describe('CourtUpdatedHandler Cache Invalidation', () => {
    it('should invalidate court cache when court is updated', async () => {
      const clubId = 123;
      const courtId = 456;

      // Pre-populate cache with court data
      const mockCourtData = [
        { id: courtId, name: 'Court 1', clubId },
        { id: 457, name: 'Court 2', clubId },
      ];
      await cacheService.set(`courts:${clubId}`, mockCourtData, 300);

      // Verify cache is populated
      const cachedCourts = await cacheService.get(`courts:${clubId}`);
      expect(cachedCourts).toEqual(mockCourtData);

      // Publish court updated event
      const event = new CourtUpdatedEvent(clubId, courtId, ['name']);
      eventBus.publish(event);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify court cache is invalidated
      const invalidatedCourts = await cacheService.get(`courts:${clubId}`);
      expect(invalidatedCourts).toBeNull();
    });

    it('should invalidate slot caches for the updated court', async () => {
      const clubId = 123;
      const courtId = 456;
      const date = '2024-01-01';

      // Pre-populate cache with slot data for the court
      const mockSlotData = [{ id: 1, start: '09:00', end: '10:00' }];
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        mockSlotData,
        300,
      );

      // Verify cache is populated
      const cachedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(cachedSlots).toEqual(mockSlotData);

      // Publish court updated event
      const event = new CourtUpdatedEvent(clubId, courtId, ['attributes']);
      eventBus.publish(event);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify slot cache is invalidated
      const invalidatedSlots = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(invalidatedSlots).toBeNull();
    });
  });

  describe('Complete Event Flow Integration', () => {
    it('should handle events sent through EventsController', async () => {
      const clubId = 123;
      const courtId = 456;
      const date = '2024-01-01';

      // Pre-populate caches
      await cacheService.set(`clubs:test-place`, [{ id: clubId }], 300);
      await cacheService.set(`courts:${clubId}`, [{ id: courtId }], 300);
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        [{ id: 1 }],
        300,
      );

      // Verify all caches are populated
      expect(await cacheService.get(`clubs:test-place`)).toBeTruthy();
      expect(await cacheService.get(`courts:${clubId}`)).toBeTruthy();
      expect(
        await cacheService.get(`slots:${clubId}:${courtId}:${date}`),
      ).toBeTruthy();

      // Send booking_created event through controller
      const bookingEvent = {
        type: 'booking_created',
        clubId,
        courtId,
        slot: {
          price: 100,
          duration: 60,
          datetime: `${date}T09:00:00`,
          start: '09:00',
          end: '10:00',
          _priority: 1,
        },
      };

      await request(app.getHttpServer())
        .post('/events')
        .send(bookingEvent)
        .expect(201);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify slot cache is invalidated
      const slotsAfterBooking = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );
      expect(slotsAfterBooking).toBeNull();

      // Other caches should still be intact
      expect(await cacheService.get(`clubs:test-place`)).toBeTruthy();
      expect(await cacheService.get(`courts:${clubId}`)).toBeTruthy();
    });

    it('should handle club_updated event with openhours through controller', async () => {
      const clubId = 123;
      const courtId = 456;
      const date = '2024-01-01';

      // Pre-populate caches
      await cacheService.set(`clubs:test-place`, [{ id: clubId }], 300);
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        [{ id: 1 }],
        300,
      );

      // Send club_updated event with openhours change
      const clubEvent = {
        type: 'club_updated',
        clubId,
        fields: ['openhours'],
      };

      await request(app.getHttpServer())
        .post('/events')
        .send(clubEvent)
        .expect(201);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify both club and slot caches are invalidated
      const clubsAfterUpdate = await cacheService.get(`clubs:test-place`);
      const slotsAfterUpdate = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );

      expect(clubsAfterUpdate).toBeNull();
      expect(slotsAfterUpdate).toBeNull();
    });

    it('should handle court_updated event through controller', async () => {
      const clubId = 123;
      const courtId = 456;
      const date = '2024-01-01';

      // Pre-populate caches
      await cacheService.set(`courts:${clubId}`, [{ id: courtId }], 300);
      await cacheService.set(
        `slots:${clubId}:${courtId}:${date}`,
        [{ id: 1 }],
        300,
      );

      // Send court_updated event
      const courtEvent = {
        type: 'court_updated',
        clubId,
        courtId,
        fields: ['name'],
      };

      await request(app.getHttpServer())
        .post('/events')
        .send(courtEvent)
        .expect(201);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify both court and slot caches are invalidated
      const courtsAfterUpdate = await cacheService.get(`courts:${clubId}`);
      const slotsAfterUpdate = await cacheService.get(
        `slots:${clubId}:${courtId}:${date}`,
      );

      expect(courtsAfterUpdate).toBeNull();
      expect(slotsAfterUpdate).toBeNull();
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle cache service errors gracefully', async () => {
      // Mock cache service to throw errors
      const originalDel = cacheService.del;
      jest
        .spyOn(cacheService, 'del')
        .mockRejectedValue(new Error('Cache error'));

      // Event should still be processed without throwing
      const event = new ClubUpdatedEvent(123, ['attributes']);

      expect(() => {
        eventBus.publish(event);
      }).not.toThrow();

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Restore original method
      jest.spyOn(cacheService, 'del').mockImplementation(originalDel);
    });

    it('should handle Redis disconnection gracefully', async () => {
      // Simulate Redis disconnection
      jest.spyOn(redisService, 'isConnected').mockReturnValue(false);

      // Pre-populate cache (this should be skipped due to disconnection)
      await cacheService.set('test-key', 'test-value', 300);

      // Publish event (should not throw even with Redis down)
      const event = new SlotBookedEvent(123, 456, {
        price: 100,
        duration: 60,
        datetime: '2024-01-01T09:00:00',
        start: '09:00',
        end: '10:00',
        _priority: 1,
      });

      expect(() => {
        eventBus.publish(event);
      }).not.toThrow();

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Restore Redis connection mock
      jest.spyOn(redisService, 'isConnected').mockReturnValue(true);
    });
  });
});
