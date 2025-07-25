import { Inject, Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import {
  ClubWithAvailability,
  GetAvailabilityQuery,
} from '../commands/get-availaiblity.query';
import { AlquilaTuCanchaClient } from '../ports/aquila-tu-cancha.client';
import { ALQUILA_TU_CANCHA_CLIENT } from '../tokens';

@QueryHandler(GetAvailabilityQuery)
export class GetAvailabilityHandler
  implements IQueryHandler<GetAvailabilityQuery>
{
  private readonly logger = new Logger(GetAvailabilityHandler.name);

  constructor(
    @Inject(ALQUILA_TU_CANCHA_CLIENT)
    private alquilaTuCanchaClient: AlquilaTuCanchaClient,
  ) {}

  async execute(query: GetAvailabilityQuery): Promise<ClubWithAvailability[]> {
    const startTime = Date.now();
    this.logger.log(
      `Starting availability search for placeId: ${
        query.placeId
      }, date: ${query.date.toISOString()}`,
    );

    const clubs_with_availability: ClubWithAvailability[] = [];

    // Performance tracking: Measure clubs fetch
    const clubsStartTime = Date.now();
    const clubs = await this.alquilaTuCanchaClient.getClubs(query.placeId);
    const clubsFetchTime = Date.now() - clubsStartTime;
    this.logger.debug(`Fetched ${clubs.length} clubs in ${clubsFetchTime}ms`);

    let totalCourtsRequests = 0;
    let totalSlotsRequests = 0;
    let totalCourtsTime = 0;
    let totalSlotsTime = 0;

    for (const club of clubs) {
      // Performance tracking: Measure courts fetch per club
      const courtsStartTime = Date.now();
      const courts = await this.alquilaTuCanchaClient.getCourts(club.id);
      const courtsFetchTime = Date.now() - courtsStartTime;
      totalCourtsRequests++;
      totalCourtsTime += courtsFetchTime;

      this.logger.debug(
        `Club ${club.id}: Fetched ${courts.length} courts in ${courtsFetchTime}ms`,
      );

      const courts_with_availability: ClubWithAvailability['courts'] = [];

      for (const court of courts) {
        // Performance tracking: Measure slots fetch per court
        const slotsStartTime = Date.now();
        const slots = await this.alquilaTuCanchaClient.getAvailableSlots(
          club.id,
          court.id,
          query.date,
        );
        const slotsFetchTime = Date.now() - slotsStartTime;
        totalSlotsRequests++;
        totalSlotsTime += slotsFetchTime;

        this.logger.debug(
          `Club ${club.id}, Court ${court.id}: Fetched ${slots.length} slots in ${slotsFetchTime}ms`,
        );

        courts_with_availability.push({
          ...court,
          available: slots,
        });
      }

      clubs_with_availability.push({
        ...club,
        courts: courts_with_availability,
      });
    }

    const totalTime = Date.now() - startTime;

    // Performance summary logging
    this.logger.log(
      `Availability search completed in ${totalTime}ms. ` +
        `Performance breakdown: ` +
        `Clubs: 1 request (${clubsFetchTime}ms), ` +
        `Courts: ${totalCourtsRequests} requests (${totalCourtsTime}ms avg: ${Math.round(
          totalCourtsTime / Math.max(totalCourtsRequests, 1),
        )}ms), ` +
        `Slots: ${totalSlotsRequests} requests (${totalSlotsTime}ms avg: ${Math.round(
          totalSlotsTime / Math.max(totalSlotsRequests, 1),
        )}ms). ` +
        `Total API calls: ${1 + totalCourtsRequests + totalSlotsRequests}`,
    );

    // N+1 Query Problem Analysis
    if (totalCourtsRequests + totalSlotsRequests > 10) {
      this.logger.warn(
        `N+1 Query Problem detected: ${
          totalCourtsRequests + totalSlotsRequests
        } sequential API calls. ` +
          `Consider implementing concurrent execution and caching.`,
      );
    }

    return clubs_with_availability;
  }
}
