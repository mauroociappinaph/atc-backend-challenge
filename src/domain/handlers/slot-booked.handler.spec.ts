import { Test, TestingModule } from '@nestjs/testing';

import { CacheService } from '../../infrastructure/services/cache.service';
import { CACHE_SERVICE } from '../tokens';
import { SlotBookedEvent } from '../events/slot-booked.event';
import { Slot } from '../model/slot';
import { SlotBookedHandler } from './slot-booked.handler';

describe('SlotBookedHandler', () => {
  let handler: SlotBookedHandler;
  let cacheService: jest.Mocked<CacheService>;

  const mockSlot: Slot = {
    price: 100,
    duration: 60,
    datetime: '2025-07-24T10:00:00',
    start: '10:00',
    end: '11:00',
    _priority: 1,
  };

  beforeEach(async () => {
    const mockCacheService = {
      del: jest.fn(),
      invalidatePattern: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlotBookedHandler,
        {
          provide: CACHE_SERVICE,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    handler = module.get<SlotBookedHandler>(SlotBookedHandler);
    cacheService = module.get(CACHE_SERVICE);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should invalidate slot cache when slot is booked', async () => {
    const event = new SlotBookedEvent(1, 2, mockSlot);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.del).toHaveBeenCalledWith('slots:1:2:2025-07-24');
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('slots:1:2:*');
  });

  it('should handle cache service errors gracefully', async () => {
    const event = new SlotBookedEvent(1, 2, mockSlot);
    const error = new Error('Cache error');

    cacheService.del.mockRejectedValue(error);
    cacheService.invalidatePattern.mockResolvedValue();

    // Should not throw
    await expect(handler.handle(event)).resolves.not.toThrow();

    expect(cacheService.del).toHaveBeenCalledWith('slots:1:2:2025-07-24');
  });

  it('should handle different date formats correctly', async () => {
    const slotWithDifferentDate: Slot = {
      ...mockSlot,
      datetime: '2025-12-31T23:59:59',
    };
    const event = new SlotBookedEvent(5, 10, slotWithDifferentDate);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.del).toHaveBeenCalledWith('slots:5:10:2025-12-31');
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('slots:5:10:*');
  });

  it('should log appropriate messages', async () => {
    const event = new SlotBookedEvent(1, 2, mockSlot);
    const logSpy = jest.spyOn(handler['logger'], 'log').mockImplementation();
    const debugSpy = jest
      .spyOn(handler['logger'], 'debug')
      .mockImplementation();

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(logSpy).toHaveBeenCalledWith(
      'Slot booked for club 1, court 2 at 2025-07-24T10:00:00',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Invalidated slot cache: slots:1:2:2025-07-24',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Invalidated slot pattern for club 1, court 2',
    );
  });

  it('should log errors when cache operations fail', async () => {
    const event = new SlotBookedEvent(1, 2, mockSlot);
    const error = new Error('Cache error');
    const errorSpy = jest
      .spyOn(handler['logger'], 'error')
      .mockImplementation();

    cacheService.del.mockRejectedValue(error);

    await handler.handle(event);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to invalidate cache for slot booking (club: 1, court: 2):',
      error,
    );
  });
});
