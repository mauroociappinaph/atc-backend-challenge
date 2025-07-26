import { Slot } from './slot';

export interface Court {
  id: number;
  name: string;
  attributes: {
    floor: string;
    light: boolean;
    roofed: boolean;
    beelup: boolean;
  };
  sports: Array<{
    id: number;
    parent_id: number;
    name: string;
    players_max: number;
    order: number;
    default_duration: number;
    divisible_duration: number;
    icon: string;
    pivot: {
      court_id: number;
      sport_id: number;
      enabled: number;
    };
  }>;
  available: Slot[];
}
