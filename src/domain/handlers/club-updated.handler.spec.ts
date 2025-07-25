import { Test, TestingModule } from '@nestjs/testing';

import { CacheService } from '../../infrastructure/services/cache.service';
import { ClubUpdatedEvent } from '../events/club-updated.event';
import { CACHE_SERVICE } from '../tokens';
import { ClubUpdatedHandler } from './club-updated.handler';

describe('ClubUpdatedHandler', () => {
  let handler: ClubUpdatedHandler;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    const mockCacheService = {
      del: jest.fn(),
      invalidatePattern: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubUpdatedHandler,
        {
          provide: CACHE_SERVICE,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    handler = module.get<ClubUpdatedHandler>(ClubUpdatedHandler);
    cacheService = module.get(CACHE_SERVICE);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  it('should invalidate club cache when club is updated', async () => {
    const event = new ClubUpdatedEvent(1, ['logo_url']);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('clubs:*');
    expect(cacheService.invalidatePattern).toHaveBeenCalledTimes(1);
  });

  it('should invalidate slot caches when openhours field is updated', async () => {
    const event = new ClubUpdatedEvent(2, ['openhours']);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('clubs:*');
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('slots:2:*');
  });

  it('should invalidate slot caches when openhours is included with other fields', async () => {
    const event = new ClubUpdatedEvent(3, [
      'logo_url',
      'openhours',
      'background_url',
    ]);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('clubs:*');
    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('slots:3:*');
  });

  it('should not invalidate slot caches when openhours is not updated', async () => {
    const event = new ClubUpdatedEvent(4, ['logo_url', 'background_url']);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('clubs:*');
    expect(cacheService.invalidatePattern).toHaveBeenCalledTimes(1);
  });

  it('should handle cache service errors gracefully', async () => {
    const event = new ClubUpdatedEvent(1, ['logo_url']);
    const error = new Error('Cache error');

    cacheService.invalidatePattern.mockRejectedValue(error);

    // Should not throw
    await expect(handler.handle(event)).resolves.not.toThrow();

    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('clubs:*');
  });

  it('should log appropriate messages', async () => {
    const event = new ClubUpdatedEvent(5, ['logo_url', 'openhours']);
    const logSpy = jest.spyOn(handler['logger'], 'log').mockImplementation();
    const debugSpy = jest
      .spyOn(handler['logger'], 'debug')
      .mockImplementation();

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(logSpy).toHaveBeenCalledWith(
      'Club 5 updated with fields: logo_url, openhours',
    );
    expect(debugSpy).toHaveBeenCalledWith('Invalidated club cache for club 5');
    expect(debugSpy).toHaveBeenCalledWith(
      'Invalidated slot caches for club 5 due to openhours change',
    );
  });

  it('should log errors when cache operations fail', async () => {
    const event = new ClubUpdatedEvent(1, ['logo_url']);
    const error = new Error('Cache error');
    const errorSpy = jest
      .spyOn(handler['logger'], 'error')
      .mockImplementation();

    cacheService.invalidatePattern.mockRejectedValue(error);

    await handler.handle(event);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to invalidate cache for club 1:',
      error,
    );
  });

  it('should handle empty fields array', async () => {
    const event = new ClubUpdatedEvent(6, []);

    cacheService.del.mockResolvedValue();
    cacheService.invalidatePattern.mockResolvedValue();

    await handler.handle(event);

    expect(cacheService.invalidatePattern).toHaveBeenCalledWith('clubs:*');
    expect(cacheService.invalidatePattern).toHaveBeenCalledTimes(1);
  });
});
