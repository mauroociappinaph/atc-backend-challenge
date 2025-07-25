import { Test, TestingModule } from '@nestjs/testing';
import * as moment from 'moment';

import { AlquilaTuCanchaClient } from '../../domain/ports/aquila-tu-cancha.client';
import { GetAvailabilityQuery } from '../commands/get-availaiblity.query';
import { Club } from '../model/club';
import { Court } from '../model/court';
import { Slot } from '../model/slot';
import { ALQUILA_TU_CANCHA_CLIENT, CACHE_SERVICE } from '../tokens';
import { GetAvailabilityHandler } from './get-availability.handler';

describe('GetAvailabilityHandler', () => {
  let handler: GetAvailabilityHandler;
  let client: FakeAlquilaTuCanchaClient;
  let cacheService: jest.Mocked<any>;

  beforeEach(async () => {
    client = new FakeAlquilaTuCanchaClient();

    const mockCacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      invalidatePattern: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetAvailabilityHandler,
        {
          provide: ALQUILA_TU_CANCHA_CLIENT,
          useValue: client,
        },
        {
          provide: CACHE_SERVICE,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    handler = module.get<GetAvailabilityHandler>(GetAvailabilityHandler);
    cacheService = module.get(CACHE_SERVICE);
  });

  it('returns the availability', async () => {
    client.clubs = {
      '123': [{ id: 1 }],
    };
    client.courts = {
      '1': [{ id: 1 }],
    };
    client.slots = {
      '1_1_2022-12-05': [],
    };
    const placeId = '123';
    const date = moment('2022-12-05').toDate();

    const response = await handler.execute(
      new GetAvailabilityQuery(placeId, date),
    );

    expect(response).toEqual([{ id: 1, courts: [{ id: 1, available: [] }] }]);
  });

  it('handles multiple clubs with concurrent execution', async () => {
    client.clubs = {
      '123': [{ id: 1 }, { id: 2 }],
    };
    client.courts = {
      '1': [{ id: 1 }],
      '2': [{ id: 2 }],
    };
    client.slots = {
      '1_1_2022-12-05': [
        {
          price: 100,
          duration: 60,
          datetime: '2022-12-05T10:00:00',
          start: '10:00',
          end: '11:00',
          _priority: 1,
        },
      ],
      '2_2_2022-12-05': [
        {
          price: 150,
          duration: 90,
          datetime: '2022-12-05T14:00:00',
          start: '14:00',
          end: '15:30',
          _priority: 1,
        },
      ],
    };
    const placeId = '123';
    const date = moment('2022-12-05').toDate();

    const response = await handler.execute(
      new GetAvailabilityQuery(placeId, date),
    );

    expect(response).toHaveLength(2);
    expect(response[0].id).toBe(1);
    expect(response[1].id).toBe(2);
    expect(response[0].courts[0].available).toHaveLength(1);
    expect(response[1].courts[0].available).toHaveLength(1);
  });

  it('deduplicates identical slot requests', async () => {
    // Setup scenario where multiple courts have same club/court/date combination
    client.clubs = {
      '123': [{ id: 1 }],
    };
    client.courts = {
      '1': [{ id: 1 }, { id: 1 }], // Duplicate court (edge case)
    };
    client.slots = {
      '1_1_2022-12-05': [
        {
          price: 100,
          duration: 60,
          datetime: '2022-12-05T10:00:00',
          start: '10:00',
          end: '11:00',
          _priority: 1,
        },
      ],
    };

    const placeId = '123';
    const date = moment('2022-12-05').toDate();

    // Spy on the client method to verify deduplication
    const getAvailableSlotsSpy = jest.spyOn(client, 'getAvailableSlots');

    const response = await handler.execute(
      new GetAvailabilityQuery(placeId, date),
    );

    // Should only call getAvailableSlots once due to deduplication
    expect(getAvailableSlotsSpy).toHaveBeenCalledTimes(1);
    expect(response[0].courts).toHaveLength(2);
    expect(response[0].courts[0].available).toEqual(
      response[0].courts[1].available,
    );
  });

  it('handles slot fetch errors gracefully', async () => {
    client.clubs = {
      '123': [{ id: 1 }],
    };
    client.courts = {
      '1': [{ id: 1 }],
    };

    // Mock error for slot fetching
    jest
      .spyOn(client, 'getAvailableSlots')
      .mockRejectedValue(new Error('API Error'));

    const placeId = '123';
    const date = moment('2022-12-05').toDate();

    const response = await handler.execute(
      new GetAvailabilityQuery(placeId, date),
    );

    // Should return empty slots array when error occurs
    expect(response).toEqual([{ id: 1, courts: [{ id: 1, available: [] }] }]);
  });

  it('logs performance metrics correctly', async () => {
    const logSpy = jest.spyOn(handler['logger'], 'log').mockImplementation();
    const debugSpy = jest
      .spyOn(handler['logger'], 'debug')
      .mockImplementation();

    client.clubs = {
      '123': [{ id: 1 }],
    };
    client.courts = {
      '1': [{ id: 1 }],
    };
    client.slots = {
      '1_1_2022-12-05': [],
    };

    const placeId = '123';
    const date = moment('2022-12-05').toDate();

    await handler.execute(new GetAvailabilityQuery(placeId, date));

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Starting optimized availability search'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Optimized availability search completed'),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('Fetched 1 clubs in'),
    );
  });

  it('reports performance target achievement', async () => {
    const logSpy = jest.spyOn(handler['logger'], 'log').mockImplementation();

    client.clubs = {
      '123': [{ id: 1 }],
    };
    client.courts = {
      '1': [{ id: 1 }],
    };
    client.slots = {
      '1_1_2022-12-05': [],
    };

    const placeId = '123';
    const date = moment('2022-12-05').toDate();

    await handler.execute(new GetAvailabilityQuery(placeId, date));

    // Should log performance target achievement (assuming fast execution in tests)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Performance target achieved'),
    );
  });

  it('triggers intelligent prefetching when response is fast', async () => {
    const debugSpy = jest
      .spyOn(handler['logger'], 'debug')
      .mockImplementation();

    client.clubs = {
      '123': [{ id: 1 }],
    };
    client.courts = {
      '1': [{ id: 1 }],
    };
    client.slots = {
      '1_1_2022-12-05': [],
    };

    const placeId = '123';
    const date = moment('2022-12-05').toDate();

    // Mock cache to return null (no cached data) to trigger prefetching
    cacheService.get.mockResolvedValue(null);

    await handler.execute(new GetAvailabilityQuery(placeId, date));

    // Wait a bit for the prefetching to complete (it runs in background)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have triggered prefetching debug logs
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('Intelligent prefetching completed'),
    );
  });

  it('skips prefetching when no future dates are available', async () => {
    const debugSpy = jest
      .spyOn(handler['logger'], 'debug')
      .mockImplementation();

    client.clubs = {
      '123': [{ id: 1 }],
    };
    client.courts = {
      '1': [{ id: 1 }],
    };
    client.slots = {
      '1_1_2022-12-05': [],
    };

    const placeId = '123';
    // Use a date that's 7 days from now, so next day (8 days) and day after (9 days)
    // would exceed the 7-day limit for prefetching
    const date = moment().add(7, 'days').toDate();

    // Manually trigger prefetching to test the 7-day limit logic
    const clubsWithCourts = [{ club: { id: 1 }, courts: [{ id: 1 }] }];
    await handler['triggerIntelligentPrefetching'](
      new GetAvailabilityQuery(placeId, date),
      clubsWithCourts,
    );

    // Wait a bit for the prefetching logic to run
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should log that no dates are available for prefetching
    expect(debugSpy).toHaveBeenCalledWith(
      'No dates available for prefetching (7-day limit)',
    );
  });
});

class FakeAlquilaTuCanchaClient implements AlquilaTuCanchaClient {
  clubs: Record<string, Club[]> = {};
  courts: Record<string, Court[]> = {};
  slots: Record<string, Slot[]> = {};
  async getClubs(placeId: string): Promise<Club[]> {
    return this.clubs[placeId];
  }
  async getCourts(clubId: number): Promise<Court[]> {
    return this.courts[String(clubId)];
  }
  async getAvailableSlots(
    clubId: number,
    courtId: number,
    date: Date,
  ): Promise<Slot[]> {
    return this.slots[
      `${clubId}_${courtId}_${moment(date).format('YYYY-MM-DD')}`
    ];
  }
}
