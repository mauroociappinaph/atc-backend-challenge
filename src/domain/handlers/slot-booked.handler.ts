import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import * as moment from 'moment';

import { CacheService } from '../../infrastructure/services/cache.service';
import { SlotBookedEvent } from '../events/slot-booked.event';
import { CACHE_SERVICE } from '../tokens';

@EventsHandler(SlotBookedEvent)
export class SlotBookedHandler implements IEventHandler<SlotBookedEvent> {
  private readonly logger = new Logger(SlotBookedHandler.name);

  constructor(@Inject(CACHE_SERVICE) private cacheService: CacheService) {}

  async handle(event: SlotBookedEvent) {
    this.logger.log(
      `Slot booked for club ${event.clubId}, court ${event.courtId} at ${event.slot.datetime}`,
    );

    try {
      // Extract date from slot datetime for cache key
      const slotDate = moment(event.slot.datetime).format('YYYY-MM-DD');
      const cacheKey = `slots:${event.clubId}:${event.courtId}:${slotDate}`;

      // Invalidate the specific slot cache
      await this.cacheService.del(cacheKey);
      this.logger.debug(`Invalidated slot cache: ${cacheKey}`);

      // Also invalidate any wildcard patterns that might include this slot
      await this.cacheService.invalidatePattern(
        `slots:${event.clubId}:${event.courtId}:*`,
      );
      this.logger.debug(
        `Invalidated slot pattern for club ${event.clubId}, court ${event.courtId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to invalidate cache for slot booking (club: ${event.clubId}, court: ${event.courtId}):`,
        error,
      );
      // Don't throw - cache invalidation failures shouldn't break event processing
    }
  }
}
