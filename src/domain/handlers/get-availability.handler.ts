import { Inject, Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import * as moment from 'moment';

import { CacheService } from '../../infrastructure/services/cache.service';
import {
  ClubWithAvailability,
  GetAvailabilityQuery,
} from '../commands/get-availaiblity.query';
import { AlquilaTuCanchaClient } from '../ports/aquila-tu-cancha.client';
import { ALQUILA_TU_CANCHA_CLIENT, CACHE_SERVICE } from '../tokens';

@QueryHandler(GetAvailabilityQuery)
export class GetAvailabilityHandler
  implements IQueryHandler<GetAvailabilityQuery>
{
  private readonly logger = new Logger(GetAvailabilityHandler.name);

  constructor(
    @Inject(ALQUILA_TU_CANCHA_CLIENT)
    private alquilaTuCanchaClient: AlquilaTuCanchaClient,
    @Inject(CACHE_SERVICE)
    private cacheService: CacheService,
  ) {}

  async execute(query: GetAvailabilityQuery): Promise<ClubWithAvailability[]> {
    const startTime = Date.now();
    this.logger.log(
      `Starting optimized availability search for placeId: ${
        query.placeId
      }, date: ${query.date.toISOString()}`,
    );

    // Performance tracking: Measure clubs fetch
    const clubsStartTime = Date.now();
    const clubs = await this.alquilaTuCanchaClient.getClubs(query.placeId);
    const clubsFetchTime = Date.now() - clubsStartTime;
    this.logger.debug(`Fetched ${clubs.length} clubs in ${clubsFetchTime}ms`);

    // Optimization 1: Concurrent execution for independent court requests
    const courtsStartTime = Date.now();
    const clubCourtsPromises = clubs.map(async (club) => {
      const courts = await this.alquilaTuCanchaClient.getCourts(club.id);
      return { club, courts };
    });

    const clubsWithCourts: Array<{ club: any; courts: any[] }> =
      await Promise.all(clubCourtsPromises);
    const courtsFetchTime = Date.now() - courtsStartTime;
    const totalCourtsRequests = clubs.length;

    this.logger.debug(
      `Fetched courts for ${
        clubs.length
      } clubs concurrently in ${courtsFetchTime}ms (avg: ${Math.round(
        courtsFetchTime / Math.max(totalCourtsRequests, 1),
      )}ms per club)`,
    );

    // Optimization 2: Request deduplication and concurrent slot fetching
    const slotsStartTime = Date.now();
    const uniqueSlotRequests = new Map<string, Promise<any>>();
    const slotRequestsData: Array<{
      club: any;
      court: any;
      requestKey: string;
    }> = [];

    // Build unique requests and track duplicates
    for (const { club, courts } of clubsWithCourts) {
      for (const court of courts) {
        const requestKey = `${club.id}_${court.id}_${
          query.date.toISOString().split('T')[0]
        }`;

        if (!uniqueSlotRequests.has(requestKey)) {
          uniqueSlotRequests.set(
            requestKey,
            this.alquilaTuCanchaClient.getAvailableSlots(
              club.id,
              court.id,
              query.date,
            ),
          );
        }

        slotRequestsData.push({ club, court, requestKey });
      }
    }

    // Execute all unique slot requests concurrently
    const uniqueSlotResults = await Promise.all(
      Array.from(uniqueSlotRequests.entries()).map(async ([key, promise]) => {
        try {
          const slots = await promise;
          return { key, slots, error: null };
        } catch (error) {
          this.logger.warn(
            `Failed to fetch slots for ${key}:`,
            error instanceof Error ? error.message : String(error),
          );
          return { key, slots: [], error };
        }
      }),
    );

    // Create results map for fast lookup
    const slotResultsMap = new Map(
      uniqueSlotResults.map(({ key, slots }) => [key, slots]),
    );

    const slotsFetchTime = Date.now() - slotsStartTime;
    const totalSlotsRequests = uniqueSlotRequests.size;
    const deduplicatedRequests = slotRequestsData.length - totalSlotsRequests;

    this.logger.debug(
      `Fetched slots for ${totalSlotsRequests} unique requests concurrently in ${slotsFetchTime}ms ` +
        `(avg: ${Math.round(
          slotsFetchTime / Math.max(totalSlotsRequests, 1),
        )}ms per request). ` +
        `Deduplicated ${deduplicatedRequests} duplicate requests.`,
    );

    // Build final result structure
    const clubs_with_availability: ClubWithAvailability[] = [];

    for (const { club, courts } of clubsWithCourts) {
      const courts_with_availability: ClubWithAvailability['courts'] = [];

      for (const court of courts) {
        const requestKey = `${club.id}_${court.id}_${
          query.date.toISOString().split('T')[0]
        }`;
        const slots = slotResultsMap.get(requestKey) || [];

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
    const totalApiCalls = 1 + totalCourtsRequests + totalSlotsRequests;

    // Performance summary logging with optimizations
    this.logger.log(
      `Optimized availability search completed in ${totalTime}ms. ` +
        `Performance breakdown: ` +
        `Clubs: 1 request (${clubsFetchTime}ms), ` +
        `Courts: ${totalCourtsRequests} concurrent requests (${courtsFetchTime}ms total), ` +
        `Slots: ${totalSlotsRequests} concurrent requests (${slotsFetchTime}ms total). ` +
        `Total API calls: ${totalApiCalls}, Deduplicated: ${deduplicatedRequests} requests. ` +
        `Performance improvement: Concurrent execution enabled.`,
    );

    // Performance analysis
    if (totalTime < 1000) {
      this.logger.log(
        `✅ Performance target achieved: ${totalTime}ms < 1000ms target`,
      );
    } else {
      this.logger.warn(
        `⚠️ Performance target missed: ${totalTime}ms > 1000ms target. ` +
          `Consider implementing intelligent prefetching or further optimizations.`,
      );
    }

    // Optimization 3: Intelligent prefetching when cache is populated
    // Only prefetch if the current request was fast (indicating cache hits)
    if (totalTime < 500) {
      this.triggerIntelligentPrefetching(query, clubsWithCourts);
    }

    return clubs_with_availability;
  }

  /**
   * Intelligent prefetching strategy: When cache is working well (fast response),
   * prefetch data for the next 2-3 days to improve future performance.
   */
  private async triggerIntelligentPrefetching(
    query: GetAvailabilityQuery,
    clubsWithCourts: Array<{ club: any; courts: any[] }>,
  ): Promise<void> {
    try {
      // Don't await - run in background
      setImmediate(async () => {
        const prefetchStartTime = Date.now();
        const currentDate = moment(query.date);
        const prefetchDates: Date[] = [];

        // Prefetch for next 2 days (within 7-day constraint)
        for (let i = 1; i <= 2; i++) {
          const nextDate = currentDate.clone().add(i, 'days');
          if (nextDate.diff(moment(), 'days') <= 7) {
            prefetchDates.push(nextDate.toDate());
          }
        }

        if (prefetchDates.length === 0) {
          this.logger.debug('No dates available for prefetching (7-day limit)');
          return;
        }

        let prefetchedCount = 0;
        const prefetchPromises: Promise<void>[] = [];

        // Prefetch slots for each club/court/date combination
        for (const { club, courts } of clubsWithCourts) {
          for (const court of courts) {
            for (const prefetchDate of prefetchDates) {
              const dateStr = moment(prefetchDate).format('YYYY-MM-DD');
              const cacheKey = `slots:${club.id}:${court.id}:${dateStr}`;

              // Only prefetch if not already cached
              const prefetchPromise = (async () => {
                try {
                  const cachedData = await this.cacheService.get(cacheKey);
                  if (!cachedData) {
                    // Prefetch in background without blocking
                    await this.alquilaTuCanchaClient.getAvailableSlots(
                      club.id,
                      court.id,
                      prefetchDate,
                    );
                    prefetchedCount++;
                  }
                } catch (error) {
                  // Ignore prefetch errors - they're not critical
                  this.logger.debug(
                    `Prefetch failed for ${cacheKey}:`,
                    error instanceof Error ? error.message : String(error),
                  );
                }
              })();

              prefetchPromises.push(prefetchPromise);
            }
          }
        }

        // Wait for all prefetch operations with timeout
        await Promise.all(
          prefetchPromises.map((p) =>
            p.catch((err) => {
              // Ignore individual prefetch failures
              this.logger.debug(
                'Prefetch operation failed:',
                err instanceof Error ? err.message : String(err),
              );
            }),
          ),
        );

        const prefetchTime = Date.now() - prefetchStartTime;
        this.logger.debug(
          `Intelligent prefetching completed: ${prefetchedCount} slots prefetched ` +
            `for ${prefetchDates.length} future dates in ${prefetchTime}ms`,
        );
      });
    } catch (error) {
      this.logger.warn(
        'Intelligent prefetching failed:',
        error instanceof Error ? error.message : String(error),
      );
      // Don't throw - prefetching failures shouldn't affect main response
    }
  }
}
