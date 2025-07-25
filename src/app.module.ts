import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';

import { ClubUpdatedHandler } from './domain/handlers/club-updated.handler';
import { CourtUpdatedHandler } from './domain/handlers/court-updated.handler';
import { GetAvailabilityHandler } from './domain/handlers/get-availability.handler';
import { SlotAvailableHandler } from './domain/handlers/slot-available.handler';
import { SlotBookedHandler } from './domain/handlers/slot-booked.handler';
import {
  ALQUILA_TU_CANCHA_CLIENT,
  CACHE_SERVICE,
  RATE_LIMITER_SERVICE,
} from './domain/tokens';
import { HTTPAlquilaTuCanchaClient } from './infrastructure/clients/http-alquila-tu-cancha.client';
import { EventsController } from './infrastructure/controllers/events.controller';
import { SearchController } from './infrastructure/controllers/search.controller';
import { CacheModule } from './infrastructure/services/cache.module';
import { CircuitBreakerService } from './infrastructure/services/circuit-breaker.service';
import { RedisRateLimiterService } from './infrastructure/services/rate-limiter.service';

@Module({
  imports: [HttpModule, CqrsModule, ConfigModule.forRoot(), CacheModule],
  controllers: [SearchController, EventsController],
  providers: [
    {
      provide: ALQUILA_TU_CANCHA_CLIENT,
      useClass: HTTPAlquilaTuCanchaClient,
    },
    {
      provide: RATE_LIMITER_SERVICE,
      useClass: RedisRateLimiterService,
    },
    GetAvailabilityHandler,
    ClubUpdatedHandler,
    CourtUpdatedHandler,
    SlotBookedHandler,
    SlotAvailableHandler,
    CircuitBreakerService,
  ],
})
export class AppModule {}
