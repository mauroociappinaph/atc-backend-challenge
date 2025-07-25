import { Test, TestingModule } from '@nestjs/testing';

import { CacheService } from '../../infrastructure/services/cache.service';
import { CourtUpdatedEvent } from '../events/court-updated.event';
import { CACHE_SERVICE } from '../tokens';
import { CourtUpdatedHandler } from './court-updated.handler';

describe('CourtUpdatedHandler', () => {
  let handler: CourtUpdatedHandler;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    const mockCacheService = {
      del: jest.fn(),
      invalidatePattern: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourtUpdatedHandler,
        {
          provide: CACHE_SERVICE,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    handler = module.get<CourtUpdatedHandler>(CourtUpdatedHandler);
    cacheService = module.get(CACHE_SERVICE);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should invalidate court and slot caches when court is updated', async () => {
    const event = new CourtUpdatedEvent(5, 6, ['name']);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.del).toHaveBeenCalledWith('courts:5');
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('slots:5:6:*');
  });

  it('should handle multiple field updates', async () => {
    const event = new CourtUpdatedEvent(10, 15, ['name', 'attributes']);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.del).toHaveBeenCalledWith('courts:10');
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith(
      'slots:10:15:*',
    );
  });

  it('should handle cache service errors gracefully', async () => {
    const event = new CourtUpdatedEvent(5, 6, ['name']);
    const error = new Error('Cache error');

    cacheService.del.mockRejectedValue(error);
    cacheService.invalidatePattern.mockResolvedValue();

    // Should not throw
    await expect(handler.handle(event)).resolves.not.toThrow();

    expect(cacheService.del).toHaveBeenCalledWith('courts:5');
  });

  it('should log appropriate messages', async () => {
    const event = new CourtUpdatedEvent(5, 6, ['name', 'attributes']);
    const logSpy = jest.spyOn(handler['logger'], 'log').mockImplementation();
    const debugSpy = jest
      .spyOn(handler['logger'], 'debug')
      .mockImplementation();

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(logSpy).toHaveBeenCalledWith(
      'Court 6 updated for club 5 with fields: name, attributes',
    );
    expect(debugSpy).toHaveBeenCalledWith('Invalidated court cache for club 5');
    expect(debugSpy).toHaveBeenCalledWith(
      'Invalidated slot caches for club 5, court 6',
    );
  });

  it('should log errors when cache operations fail', async () => {
    const event = new CourtUpdatedEvent(5, 6, ['name']);
    const error = new Error('Cache error');
    const errorSpy = jest
      .spyOn(handler['logger'], 'error')
      .mockImplementation();

    cacheService.del.mockRejectedValue(error);

    await handler.handle(event);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to invalidate cache for court update (club: 5, court: 6):',
      error,
    );
  });
});
