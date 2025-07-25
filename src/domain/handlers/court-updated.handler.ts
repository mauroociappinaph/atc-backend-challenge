import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { CacheService } from '../../infrastructure/services/cache.service';
import { CourtUpdatedEvent } from '../events/court-updated.event';
import { CACHE_SERVICE } from '../tokens';

@EventsHandler(CourtUpdatedEvent)
export class CourtUpdatedHandler implements IEventHandler<CourtUpdatedEvent> {
  private readonly logger = new Logger(CourtUpdatedHandler.name);

  constructor(@Inject(CACHE_SERVICE) private cacheService: CacheService) {}

  async handle(event: CourtUpdatedEvent) {
    this.logger.log(
      `Court ${event.courtId} updated for club ${
        event.clubId
      } with fields: ${event.fields.join(', ')}`,
    );

    try {
      // Invalidate court cache for the specific club
      await this.cacheService.del(`courts:${event.clubId}`);
      this.logger.debug(`Invalidated court cache for club ${event.clubId}`);

      // Court updates typically affect metadata only, but we should also invalidate
      // any cached slot data for this specific court to be safe
      await this.cacheService.invalidatePattern(
        `slots:${event.clubId}:${event.courtId}:*`,
      );
      this.logger.debug(
        `Invalidated slot caches for club ${event.clubId}, court ${event.courtId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to invalidate cache for court update (club: ${event.clubId}, court: ${event.courtId}):`,
        error,
      );
      // Don't throw - cache invalidation failures shouldn't break event processing
    }
  }
}
