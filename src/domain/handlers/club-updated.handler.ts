import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { CacheService } from '../../infrastructure/services/cache.service';
import { ClubUpdatedEvent } from '../events/club-updated.event';
import { CACHE_SERVICE } from '../tokens';

@EventsHandler(ClubUpdatedEvent)
export class ClubUpdatedHandler implements IEventHandler<ClubUpdatedEvent> {
  private readonly logger = new Logger(ClubUpdatedHandler.name);

  constructor(@Inject(CACHE_SERVICE) private cacheService: CacheService) {}

  async handle(event: ClubUpdatedEvent) {
    this.logger.log(
      `Club ${event.clubId} updated with fields: ${event.fields.join(', ')}`,
    );

    try {
      // Invalidate club cache
      await this.cacheService.invalidatePattern(`clubs:*`);
      this.logger.debug(`Invalidated club cache for club ${event.clubId}`);

      // If openhours field changed, invalidate slot caches as availability might change
      if (event.fields.includes('openhours')) {
        await this.cacheService.invalidatePattern(`slots:${event.clubId}:*`);
        this.logger.debug(
          `Invalidated slot caches for club ${event.clubId} due to openhours change`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to invalidate cache for club ${event.clubId}:`,
        error,
      );
      // Don't throw - cache invalidation failures shouldn't break event processing
    }
  }
}
