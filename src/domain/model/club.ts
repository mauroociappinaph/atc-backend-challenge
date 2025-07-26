import { Court } from './court';

export interface Club {
  id: number;
  permalink: string;
  name: string;
  logo: string;
  logo_url: string;
  background: string;
  background_url: string;
  location: {
    name: string;
    city: string;
    lat: string;
    lng: string;
  };
  zone: {
    id: number;
    name: string;
    full_name: string;
    placeid: string;
    country: {
      id: number;
      name: string;
      iso_code: string;
    };
  };
  props: {
    sponsor: boolean;
    favorite: boolean;
    stars: string;
    payment: boolean;
  };
  attributes: string[];
  openhours: Array<{
    day_of_week: number;
    open_time: number;
    close_time: number;
    open: boolean;
  }>;
  courts: Court[];
  _priority: number;
}
