import { Club } from '../model/club';
import { Court } from '../model/court';
import { Slot } from '../model/slot';
import { ALQUILA_TU_CANCHA_CLIENT } from '../tokens';

export { ALQUILA_TU_CANCHA_CLIENT };
export interface AlquilaTuCanchaClient {
  getClubs(placeId: string): Promise<Club[]>;
  getCourts(clubId: number): Promise<Court[]>;
  getAvailableSlots(
    clubId: number,
    courtId: number,
    date: Date,
  ): Promise<Slot[]>;
}
