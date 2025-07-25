import { Test, TestingModule } from '@nestjs/testing';

import { CacheService } from '../../infrastructure/services/cache.service';
import { CACHE_SERVICE } from '../tokens';
import { SlotAvailableEvent } from '../events/slot-cancelled.event';
import { Slot } from '../model/slot';
import { SlotAvailableHandler } from './slot-available.handler';

describe('SlotAvailableHandler', () => {
  let handler: SlotAvailableHandler;
  let cacheService: jest.Mocked<CacheService>;

  const mockSlot: Slot = {
    price: 100,
    duration: 60,
    datetime: '2025-07-24T14:30:00',
    start: '14:30',
    end: '15:30',
    _priority: 1,
  };

  beforeEach(async () => {
    const mockCacheService = {
      del: jest.fn(),
      invalidatePattern: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlotAvailableHandler,
        {
          provide: CACHE_SERVICE,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    handler = module.get<SlotAvailableHandler>(SlotAvailableHandler);
    cacheService = module.get(CACHE_SERVICE);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should invalidate slot cache when slot becomes available', async () => {
    const event = new SlotAvailableEvent(3, 4, mockSlot);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.del).toHaveBeenCalledWith('slots:3:4:2025-07-24');
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('slots:3:4:*');
  });

  it('should handle cache service errors gracefully', async () => {
    const event = new SlotAvailableEvent(3, 4, mockSlot);
    const error = new Error('Cache error');

    cacheService.del.mockRejectedValue(error);
    cacheService.invalidatePattern.mockResolvedValue();

    // Should not throw
    await expect(handler.handle(event)).resolves.not.toThrow();

    expect(cacheService.del).toHaveBeenCalledWith('slots:3:4:2025-07-24');
  });

  it('should handle different date formats correctly', async () => {
    const slotWithDifferentDate: Slot = {
      ...mockSlot,
      datetime: '2025-01-01T00:00:00',
    };
    const event = new SlotAvailableEvent(7, 8, slotWithDifferentDate);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.del).toHaveBeenCalledWith('slots:7:8:2025-01-01');
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('slots:7:8:*');
  });

  it('should log appropriate messages', async () => {
    const event = new SlotAvailableEvent(3, 4, mockSlot);
    const logSpy = jest.spyOn(handler['logger'], 'log').mockImplementation();
    const debugSpy = jest
      .spyOn(handler['logger'], 'debug')
      .mockImplementation();

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(logSpy).toHaveBeenCalledWith(
      'Slot became available for club 3, court 4 at 2025-07-24T14:30:00',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Invalidated slot cache: slots:3:4:2025-07-24',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Invalidated slot pattern for club 3, court 4',
    );
  });

  it('should log errors when cache operations fail', async () => {
    const event = new SlotAvailableEvent(3, 4, mockSlot);
    const error = new Error('Cache error');
    const errorSpy = jest
      .spyOn(handler['logger'], 'error')
      .mockImplementation();

    cacheService.del.mockRejectedValue(error);

    await handler.handle(event);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to invalidate cache for slot availability (club: 3, court: 4):',
      error,
    );
  });
});
