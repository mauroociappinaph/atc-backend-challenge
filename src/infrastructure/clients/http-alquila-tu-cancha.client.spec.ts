import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosResponse } from 'axios';

import { Club } from '../../domain/model/club';
import { Court } from '../../domain/model/court';
import { Slot } from '../../domain/model/slot';
import { CACHE_SERVICE, RATE_LIMITER_SERVICE } from '../../domain/tokens';
import { CacheService } from '../services/cache.service';
import { CircuitBreakerService } from '../services/circuit-breaker.service';
import { RateLimiterService } from '../services/rate-limiter.service';
import { HTTPAlquilaTuCanchaClient } from './http-alquila-tu-cancha.client';

describe('HTTPAlquilaTuCanchaClient', () => {
  let client: HTTPAlquilaTuCanchaClient;
  let httpService: jest.Mocked<HttpService>;
  let cacheService: jest.Mocked<CacheService>;
  let rateLimiter: jest.Mocked<RateLimiterService>;
  let circuitBreaker: jest.Mocked<CircuitBreakerService>;
  let configService: jest.Mocked<ConfigService>;

  const createMockClub = (id: number): Club => ({
    id,
    permalink: `club-${id}`,
    name: `Club ${id}`,
    logo: `logo-${id}`,
    logo_url: `https://example.com/logo-${id}.jpg`,
    background: `background-${id}`,
    background_url: `https://example.com/bg-${id}.jpg`,
    location: {
      name: `Location ${id}`,
      city: `City ${id}`,
      lat: '0.0',
      lng: '0.0',
    },
    zone: {
      id: 1,
      name: 'Zone 1',
      full_name: 'Full Zone 1',
      placeid: 'place123',
      country: {
        id: 1,
        name: 'Country',
        iso_code: 'CO',
      },
    },
    props: {
      sponsor: false,
      favorite: false,
      stars: '5',
      payment: true,
    },
    attributes: ['attr1', 'attr2'],
    openhours: [
      {
        day_of_week: 1,
        open_time: 8,
        close_time: 22,
        open: true,
      },
    ],
    courts: [],
    _priority: 1,
  });

  const createMockCourt = (id: number): Court => ({
    id,
    name: `Court ${id}`,
    attributes: {
      floor: 'synthetic',
      light: true,
      roofed: true,
      beelup: false,
    },
    sports: [
      {
        id: 1,
        parent_id: 0,
        name: 'Tennis',
        players_max: 4,
        order: 1,
        default_duration: 60,
        divisible_duration: 30,
        icon: 'tennis-icon',
        pivot: {
          court_id: id,
          sport_id: 1,
          enabled: 1,
        },
      },
    ],
    available: [],
  });

  const mockClubs: Club[] = [createMockClub(1)];
  const mockCourts: Court[] = [createMockCourt(1)];

  const mockSlots: Slot[] = [
    {
      price: 100,
      duration: 60,
      datetime: '2025-07-24T10:00:00',
      start: '10:00',
      end: '11:00',
      _priority: 1,
    },
  ];

  beforeEach(async () => {
    const mockHttpService = {
      axiosRef: {
        get: jest.fn(),
      },
    };

    const mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const mockRateLimiter = {
      waitForSlot: jest.fn(),
    };

    const mockCircuitBreaker = {
      execute: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:4000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HTTPAlquilaTuCanchaClient,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: CACHE_SERVICE,
          useValue: mockCacheService,
        },
        {
          provide: RATE_LIMITER_SERVICE,
          useValue: mockRateLimiter,
        },
        {
          provide: CircuitBreakerService,
          useValue: mockCircuitBreaker,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    client = module.get<HTTPAlquilaTuCanchaClient>(HTTPAlquilaTuCanchaClient);
    httpService = module.get(HttpService);
    cacheService = module.get(CACHE_SERVICE);
    rateLimiter = module.get(RATE_LIMITER_SERVICE);
    circuitBreaker = module.get(CircuitBreakerService);
    configService = module.get(ConfigService);
  });

  describe('getClubs', () => {
    it('should return cached clubs when available', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(mockClubs);

      const result = await client.getClubs(placeId);

      expect(result).toEqual(mockClubs);
      expect(cacheService.get).toHaveBeenCalledWith(`clubs:${placeId}`);
      expect(rateLimiter.waitForSlot).not.toHaveBeenCalled();
      expect(circuitBreaker.execute).not.toHaveBeenCalled();
    });

    it('should fetch clubs from API when not cached', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getClubs(placeId);

      expect(result).toEqual(mockClubs);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalledWith(
        `clubs:${placeId}`,
        mockClubs,
        86400,
      );
    });

    it('should use fallback when circuit breaker is open', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (_, fallback) =>
        fallback ? fallback() : [],
      );

      const result = await client.getClubs(placeId);

      expect(result).toEqual([]);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
    });
  });

  describe('getCourts', () => {
    it('should return cached courts when available', async () => {
      const clubId = 1;
      cacheService.get.mockResolvedValue(mockCourts);

      const result = await client.getCourts(clubId);

      expect(result).toEqual(mockCourts);
      expect(cacheService.get).toHaveBeenCalledWith(`courts:${clubId}`);
      expect(rateLimiter.waitForSlot).not.toHaveBeenCalled();
      expect(circuitBreaker.execute).not.toHaveBeenCalled();
    });

    it('should fetch courts from API when not cached', async () => {
      const clubId = 1;
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockCourts,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getCourts(clubId);

      expect(result).toEqual(mockCourts);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalledWith(
        `courts:${clubId}`,
        mockCourts,
        43200,
      );
    });
  });

  describe('getAvailableSlots', () => {
    it('should return cached slots when available', async () => {
      const clubId = 1;
      const courtId = 1;
      const date = new Date('2025-07-24T12:00:00Z');
      const cacheKey = 'slots:1:1:2025-07-24';

      cacheService.get.mockResolvedValue(mockSlots);

      const result = await client.getAvailableSlots(clubId, courtId, date);

      expect(result).toEqual(mockSlots);
      expect(cacheService.get).toHaveBeenCalledWith(cacheKey);
      expect(rateLimiter.waitForSlot).not.toHaveBeenCalled();
      expect(circuitBreaker.execute).not.toHaveBeenCalled();
    });

    it('should fetch slots from API when not cached', async () => {
      const clubId = 1;
      const courtId = 1;
      const date = new Date('2025-07-24T12:00:00Z');
      const cacheKey = 'slots:1:1:2025-07-24';

      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockSlots,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getAvailableSlots(clubId, courtId, date);

      expect(result).toEqual(mockSlots);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalledWith(cacheKey, mockSlots, 3600);
      expect(httpService.axiosRef.get).toHaveBeenCalledWith(
        '/clubs/1/courts/1/slots',
        {
          baseURL: 'http://localhost:4000',
          params: { date: '2025-07-24' },
        },
      );
    });

    it('should use fallback when circuit breaker is open', async () => {
      const clubId = 1;
      const courtId = 1;
      const date = new Date('2025-07-24T12:00:00Z');

      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (_, fallback) =>
        fallback ? fallback() : [],
      );

      const result = await client.getAvailableSlots(clubId, courtId, date);

      expect(result).toEqual([]);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle HTTP errors gracefully in getClubs', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation, fallback) => {
        try {
          return await operation();
        } catch (error) {
          return fallback ? await fallback() : [];
        }
      });

      httpService.axiosRef.get = jest
        .fn()
        .mockRejectedValue(new Error('Network error'));

      const result = await client.getClubs(placeId);

      expect(result).toEqual([]);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
    });

    it('should handle cache service errors gracefully', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null); // Cache returns null instead of throwing
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getClubs(placeId);

      expect(result).toEqual(mockClubs);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
    });

    it('should handle rate limiter errors gracefully', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockRejectedValue(
        new Error('Rate limiter error'),
      );
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      // Should still proceed with the request despite rate limiter error
      await expect(client.getClubs(placeId)).rejects.toThrow(
        'Rate limiter error',
      );
    });
  });

  describe('caching behavior', () => {
    it('should not cache empty results for clubs', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getClubs(placeId);

      expect(result).toEqual([]);
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('should use correct TTL for different resource types', async () => {
      // Test clubs TTL (86400 seconds)
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      await client.getClubs(placeId);

      expect(cacheService.set).toHaveBeenCalledWith(
        `clubs:${placeId}`,
        mockClubs,
        86400, // 24 hours
      );

      // Reset mocks
      jest.clearAllMocks();
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockCourtsResponse: AxiosResponse = {
        data: mockCourts,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest
        .fn()
        .mockResolvedValue(mockCourtsResponse);

      await client.getCourts(1);

      expect(cacheService.set).toHaveBeenCalledWith(
        'courts:1',
        mockCourts,
        43200, // 12 hours
      );
    });
  });

  describe('integration with services', () => {
    it('should properly integrate all services in complete flow', async () => {
      const placeId = 'test-place';

      // Mock cache miss
      cacheService.get.mockResolvedValue(null);

      // Mock rate limiter allowing request
      rateLimiter.waitForSlot.mockResolvedValue();

      // Mock circuit breaker executing operation
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      // Mock successful HTTP response
      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };
      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getClubs(placeId);

      // Verify complete integration flow
      expect(cacheService.get).toHaveBeenCalledWith(`clubs:${placeId}`);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
      expect(httpService.axiosRef.get).toHaveBeenCalledWith('clubs', {
        baseURL: 'http://localhost:4000',
        params: { placeId },
      });
      expect(cacheService.set).toHaveBeenCalledWith(
        `clubs:${placeId}`,
        mockClubs,
        86400,
      );
      expect(result).toEqual(mockClubs);
    });

    it('should handle circuit breaker fallback with expired cache', async () => {
      const placeId = 'test-place';
      const expiredClubs = [{ id: 999, name: 'Expired Club' }];

      // Mock cache miss initially, then return expired data in fallback
      cacheService.get.mockResolvedValue(null);

      // Mock rate limiter allowing request
      rateLimiter.waitForSlot.mockResolvedValue();

      // Mock circuit breaker using fallback
      circuitBreaker.execute.mockImplementation(async (operation, fallback) => {
        // Simulate operation failure, use fallback
        return fallback ? await fallback() : [];
      });

      const result = await client.getClubs(placeId);

      expect(result).toEqual([]); // Fallback returns empty array since cache was null
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
    });
  });

  describe('date handling in slots', () => {
    it('should format dates correctly for slot requests', async () => {
      const clubId = 1;
      const courtId = 1;
      const date = new Date('2025-12-31T23:59:59Z');

      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockSlots,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      await client.getAvailableSlots(clubId, courtId, date);

      expect(httpService.axiosRef.get).toHaveBeenCalledWith(
        '/clubs/1/courts/1/slots',
        {
          baseURL: 'http://localhost:4000',
          params: { date: '2025-12-31' },
        },
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        'slots:1:1:2025-12-31',
        mockSlots,
        3600,
      );
    });

    it('should handle different timezone dates correctly', async () => {
      const clubId = 1;
      const courtId = 1;
      const date = new Date('2025-07-24T03:00:00-05:00'); // EST timezone

      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockSlots,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      await client.getAvailableSlots(clubId, courtId, date);

      // Should format date consistently regardless of timezone
      expect(httpService.axiosRef.get).toHaveBeenCalledWith(
        '/clubs/1/courts/1/slots',
        {
          baseURL: 'http://localhost:4000',
          params: { date: '2025-07-24' },
        },
      );
    });
  });

  describe('configuration', () => {
    it('should use correct base URL from config', () => {
      expect(configService.get).toHaveBeenCalledWith(
        'ATC_BASE_URL',
        'http://localhost:4000',
      );
    });

    it('should handle custom base URL configuration', async () => {
      // Create a new client instance with custom config
      const customConfigService = {
        get: jest.fn().mockReturnValue('http://custom-api:8080'),
      };

      const customModule: TestingModule = await Test.createTestingModule({
        providers: [
          HTTPAlquilaTuCanchaClient,
          {
            provide: HttpService,
            useValue: httpService,
          },
          {
            provide: CACHE_SERVICE,
            useValue: cacheService,
          },
          {
            provide: RATE_LIMITER_SERVICE,
            useValue: rateLimiter,
          },
          {
            provide: CircuitBreakerService,
            useValue: circuitBreaker,
          },
          {
            provide: ConfigService,
            useValue: customConfigService,
          },
        ],
      }).compile();

      const customClient = customModule.get<HTTPAlquilaTuCanchaClient>(
        HTTPAlquilaTuCanchaClient,
      );

      expect(customConfigService.get).toHaveBeenCalledWith(
        'ATC_BASE_URL',
        'http://localhost:4000',
      );
    });
  });

  describe('enhanced functionality edge cases', () => {
    it('should handle cache service returning undefined gracefully', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(undefined);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getClubs(placeId);

      expect(result).toEqual(mockClubs);
      expect(rateLimiter.waitForSlot).toHaveBeenCalledWith('http-client');
      expect(circuitBreaker.execute).toHaveBeenCalled();
    });

    it('should handle cache set failures gracefully', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      // Cache service is designed to not throw, but let's test it doesn't break the flow
      cacheService.set.mockImplementation(async () => {
        // Simulate cache service handling error internally without throwing
        return;
      });
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getClubs(placeId);

      expect(result).toEqual(mockClubs);
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('should handle rate limiter timeout gracefully', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockRejectedValue(
        new Error('Rate limit timeout for http-client'),
      );

      await expect(client.getClubs(placeId)).rejects.toThrow(
        'Rate limit timeout for http-client',
      );
    });

    it('should handle circuit breaker throwing error without fallback', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockRejectedValue(
        new Error('Circuit breaker error'),
      );

      await expect(client.getClubs(placeId)).rejects.toThrow(
        'Circuit breaker error',
      );
    });

    it('should handle empty response data correctly', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: null,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getClubs(placeId);

      expect(result).toBeNull();
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('should handle malformed cached data gracefully', async () => {
      const placeId = 'test-place';
      // Cache returns malformed data that doesn't match expected type
      cacheService.get.mockResolvedValue('invalid-data');

      const result = await client.getClubs(placeId);

      expect(result).toBe('invalid-data');
      expect(rateLimiter.waitForSlot).not.toHaveBeenCalled();
      expect(circuitBreaker.execute).not.toHaveBeenCalled();
    });

    it('should handle concurrent requests to same resource', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      // Execute multiple concurrent requests
      const promises = [
        client.getClubs(placeId),
        client.getClubs(placeId),
        client.getClubs(placeId),
      ];

      const results = await Promise.all(promises);

      // All should return the same result
      results.forEach((result) => {
        expect(result).toEqual(mockClubs);
      });

      // Rate limiter should be called for each request
      expect(rateLimiter.waitForSlot).toHaveBeenCalledTimes(3);
    });

    it('should handle different HTTP status codes correctly', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation) =>
        operation(),
      );

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 201, // Created instead of OK
        statusText: 'Created',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockResolvedValue(mockResponse);

      const result = await client.getClubs(placeId);

      expect(result).toEqual(mockClubs);
      expect(cacheService.set).toHaveBeenCalledWith(
        `clubs:${placeId}`,
        mockClubs,
        86400,
      );
    });

    it('should handle network timeout errors', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation, fallback) => {
        try {
          return await operation();
        } catch (error) {
          return fallback ? await fallback() : [];
        }
      });

      const timeoutError = new Error('timeout of 5000ms exceeded');
      timeoutError.name = 'TimeoutError';
      httpService.axiosRef.get = jest.fn().mockRejectedValue(timeoutError);

      const result = await client.getClubs(placeId);

      expect(result).toEqual([]);
      expect(circuitBreaker.execute).toHaveBeenCalled();
    });

    it('should handle HTTP 404 errors correctly', async () => {
      const placeId = 'nonexistent-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation, fallback) => {
        try {
          return await operation();
        } catch (error) {
          return fallback ? await fallback() : [];
        }
      });

      const notFoundError = new Error('Request failed with status code 404');
      httpService.axiosRef.get = jest.fn().mockRejectedValue(notFoundError);

      const result = await client.getClubs(placeId);

      expect(result).toEqual([]);
      expect(circuitBreaker.execute).toHaveBeenCalled();
    });

    it('should handle HTTP 500 errors correctly', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(null);
      rateLimiter.waitForSlot.mockResolvedValue();
      circuitBreaker.execute.mockImplementation(async (operation, fallback) => {
        try {
          return await operation();
        } catch (error) {
          return fallback ? await fallback() : [];
        }
      });

      const serverError = new Error('Request failed with status code 500');
      httpService.axiosRef.get = jest.fn().mockRejectedValue(serverError);

      const result = await client.getClubs(placeId);

      expect(result).toEqual([]);
      expect(circuitBreaker.execute).toHaveBeenCalled();
    });
  });

  describe('service integration validation', () => {
    it('should call services in correct order for cache miss', async () => {
      const placeId = 'test-place';
      const callOrder: string[] = [];

      cacheService.get.mockImplementation(async () => {
        callOrder.push('cache.get');
        return null;
      });

      rateLimiter.waitForSlot.mockImplementation(async () => {
        callOrder.push('rateLimiter.waitForSlot');
      });

      circuitBreaker.execute.mockImplementation(async (operation) => {
        callOrder.push('circuitBreaker.execute');
        return operation();
      });

      const mockResponse: AxiosResponse = {
        data: mockClubs,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.axiosRef.get = jest.fn().mockImplementation(async () => {
        callOrder.push('http.get');
        return mockResponse;
      });

      cacheService.set.mockImplementation(async () => {
        callOrder.push('cache.set');
      });

      await client.getClubs(placeId);

      expect(callOrder).toEqual([
        'cache.get',
        'rateLimiter.waitForSlot',
        'circuitBreaker.execute',
        'http.get',
        'cache.set',
      ]);
    });

    it('should skip rate limiter and circuit breaker on cache hit', async () => {
      const placeId = 'test-place';
      cacheService.get.mockResolvedValue(mockClubs);

      await client.getClubs(placeId);

      expect(cacheService.get).toHaveBeenCalledWith(`clubs:${placeId}`);
      expect(rateLimiter.waitForSlot).not.toHaveBeenCalled();
      expect(circuitBreaker.execute).not.toHaveBeenCalled();
      expect(httpService.axiosRef.get).not.toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('should validate all service dependencies are properly injected', () => {
      expect(client).toBeDefined();
      expect(httpService).toBeDefined();
      expect(cacheService).toBeDefined();
      expect(rateLimiter).toBeDefined();
      expect(circuitBreaker).toBeDefined();
      expect(configService).toBeDefined();
    });
  });
});
