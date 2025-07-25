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

  const mockClubs: Club[] = [{ id: 1 }];

  const mockCourts: Court[] = [{ id: 1 }];

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
        300,
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
        600,
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
      expect(cacheService.set).toHaveBeenCalledWith(cacheKey, mockSlots, 300);
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

  describe('configuration', () => {
    it('should use correct base URL from config', () => {
      expect(configService.get).toHaveBeenCalledWith(
        'ATC_BASE_URL',
        'http://localhost:4000',
      );
    });
  });
});
