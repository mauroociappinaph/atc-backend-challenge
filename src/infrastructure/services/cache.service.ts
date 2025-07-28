import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from './redis.service';

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<void>;
  getMetrics(): CacheMetrics;
  resetMetrics(): void;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  total: number;
  hitRatio: number;
  operations: {
    gets: number;
    sets: number;
    deletes: number;
    invalidations: number;
  };
}

@Injectable()
export class RedisCacheService implements CacheService {
  private readonly logger = new Logger(RedisCacheService.name);

  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    total: 0,
    hitRatio: 0,
    operations: {
      gets: 0,
      sets: 0,
      deletes: 0,
      invalidations: 0,
    },
  };

  private readonly defaultTtls = {
    clubs: 86400,
    courts: 43200,
    slots: 3600,
  };

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    this.metrics.operations.gets++;

    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn('Redis no conectado, fallo de cache para:', key);
        this.recordMiss();
        return null;
      }

      const value = await this.redisService.get(key);
      if (value === null) {
        this.logger.debug(`Cache miss para: ${key}`);
        this.recordMiss();
        return null;
      }

      this.logger.debug(`Cache hit para: ${key}`);
      this.recordHit();
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Error al obtener cache ${key}:`, error);
      this.recordMiss();
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.metrics.operations.sets++;

    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn('Redis no conectado, omitiendo guardado para:', key);
        return;
      }

      const serializedValue = JSON.stringify(value);
      const effectiveTtl = ttl || this.getDefaultTtl(key);

      await this.redisService.set(key, serializedValue, effectiveTtl);
      this.logger.debug(
        `Cache guardado para: ${key} con TTL: ${effectiveTtl}s`,
      );
    } catch (error) {
      this.logger.error(`Error al guardar cache ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    this.metrics.operations.deletes++;

    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn(
          'Redis no conectado, omitiendo eliminación para:',
          key,
        );
        return;
      }

      await this.redisService.del(key);
      this.logger.debug(`Cache eliminado para: ${key}`);
    } catch (error) {
      this.logger.error(`Error al eliminar cache ${key}:`, error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    this.metrics.operations.invalidations++;

    try {
      if (!this.redisService.isConnected()) {
        this.logger.warn(
          'Redis no conectado, omitiendo limpieza de patrón:',
          pattern,
        );
        return;
      }

      const client = this.redisService.getClient();
      const keys = await client.keys(pattern);

      if (keys.length > 0) {
        await client.del(...keys);
        this.logger.debug(
          `Invalidadas ${keys.length} claves del patrón: ${pattern}`,
        );
      } else {
        this.logger.debug(
          `No se encontraron claves para el patrón: ${pattern}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error al invalidar patrón ${pattern}:`, error);
    }
  }

  private getDefaultTtl(key: string): number {
    if (key.startsWith('clubs:')) {
      return this.configService.get<number>(
        'CACHE_TTL_CLUBS',
        this.defaultTtls.clubs,
      );
    }
    if (key.startsWith('courts:')) {
      return this.configService.get<number>(
        'CACHE_TTL_COURTS',
        this.defaultTtls.courts,
      );
    }
    if (key.startsWith('slots:')) {
      return this.configService.get<number>(
        'CACHE_TTL_SLOTS',
        this.defaultTtls.slots,
      );
    }

    return this.defaultTtls.slots;
  }

  private recordHit(): void {
    this.metrics.hits++;
    this.metrics.total++;
    this.updateHitRatio();
  }

  private recordMiss(): void {
    this.metrics.misses++;
    this.metrics.total++;
    this.updateHitRatio();
  }

  private updateHitRatio(): void {
    this.metrics.hitRatio =
      this.metrics.total > 0 ? this.metrics.hits / this.metrics.total : 0;
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      total: 0,
      hitRatio: 0,
      operations: {
        gets: 0,
        sets: 0,
        deletes: 0,
        invalidations: 0,
      },
    };
  }
}
