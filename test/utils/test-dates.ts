import * as moment from 'moment';

/**
 * Utility functions for generating valid test dates
 */
export class TestDateUtils {
  /**
   * Get a valid date for testing (tomorrow)
   */
  static getValidTestDate(): string {
    return moment().add(1, 'day').format('YYYY-MM-DD');
  }

  /**
   * Get multiple valid test dates within the 7-day window
   */
  static getValidTestDates(count = 3): string[] {
    const dates: string[] = [];
    for (let i = 1; i <= Math.min(count, 6); i++) {
      dates.push(moment().add(i, 'day').format('YYYY-MM-DD'));
    }
    return dates;
  }

  /**
   * Get a date that's in the past (for negative testing)
   */
  static getPastDate(): string {
    return moment().subtract(1, 'day').format('YYYY-MM-DD');
  }

  /**
   * Get a date that's too far in the future (for negative testing)
   */
  static getFutureDateOutOfRange(): string {
    return moment().add(8, 'days').format('YYYY-MM-DD');
  }

  /**
   * Get the maximum valid date (6 days from today)
   */
  static getMaxValidDate(): string {
    return moment().add(6, 'days').format('YYYY-MM-DD');
  }
}
