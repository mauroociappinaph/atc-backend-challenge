/**
 * Helper functions to validate API response formats in tests
 */

export interface ClubResponse {
  id: number;
  courts: CourtResponse[];
  [key: string]: any;
}

export interface CourtResponse {
  id: number;
  available: SlotResponse[];
  [key: string]: any;
}

export interface SlotResponse {
  price: number;
  duration: number;
  datetime: string;
  start: string;
  end: string;
  [key: string]: any;
}

/**
 * Validates that the response has the expected format for search endpoint
 * Should return an array of clubs, not wrapped in {clubs: [...]}
 */
export function validateSearchResponse(response: any): void {
  expect(Array.isArray(response)).toBe(true);

  if (response.length > 0) {
    const club = response[0];
    expect(club).toHaveProperty('id');
    expect(typeof club.id).toBe('number');

    if (club.courts && club.courts.length > 0) {
      expect(Array.isArray(club.courts)).toBe(true);
      const court = club.courts[0];
      expect(court).toHaveProperty('id');
      expect(typeof court.id).toBe('number');
      expect(Array.isArray(court.available)).toBe(true);
    }
  }
}

/**
 * Validates that the response is NOT wrapped in {clubs: [...]} format
 */
export function validateNotWrappedResponse(response: any): void {
  expect(response).not.toHaveProperty('clubs');
  expect(Array.isArray(response)).toBe(true);
}

/**
 * Creates a mock club response for testing
 */
export function createMockClubResponse(id: number): ClubResponse {
  return {
    id,
    courts: [
      {
        id: 1,
        available: [
          {
            price: 100,
            duration: 60,
            datetime: '2025-07-26T10:00:00',
            start: '10:00',
            end: '11:00',
          },
        ],
      },
    ],
  };
}
