import * as moment from 'moment';

export class TestDateUtils {
  /**
   * Returns a valid test date (tomorrow) in YYYY-MM-DD format
   * This ensures the date is always within the valid 7-day window
   */
  static getValidTestDate(): string {
    return moment().add(1, 'day').format('YYYY-MM-DD');
  }

  /**
   * Returns a date that's in the past (should be rejected)
   */
  static getPastDate(): string {
    return moment().subtract(1, 'day').format('YYYY-MM-DD');
  }

  /**
   * Returns a date that's too far in the future (should be rejected)
   */
  static getFutureDate(): string {
    return moment().add(8, 'days').format('YYYY-MM-DD');
  }

  /**
   * Returns today's date in YYYY-MM-DD format
   */
  static getTodayDate(): string {
    return moment().format('YYYY-MM-DD');
  }

  /**
   * Returns a date N days from today
   */
  static getDateFromToday(days: number): string {
    return moment().add(days, 'days').format('YYYY-MM-DD');
  }

  /**
   * Returns multiple valid test dates for batch testing
   */
  static getMultipleValidDates(count = 3): string[] {
    const dates: string[] = [];
    for (let i = 1; i <= count; i++) {
      dates.push(moment().add(i, 'days').format('YYYY-MM-DD'));
    }
    return dates;
  }
}
