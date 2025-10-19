export interface PlaceSuggestion {
  id: string;
  name: string;
  context: string;
  lat: number;
  lon: number;
  distanceMeters?: number;
}

export interface EntranceResult {
  id: string;
  name: string;
  center: { lat: number; lon: number };
  bbox: [number, number, number, number];
  method: string;
  entrance: {
    lat: number;
    lon: number;
    confidence: 'high' | 'medium' | 'low';
    accessible: boolean;
  };
  dropoff?: {
    lat: number;
    lon: number;
  };
  footprint?: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
  paths?: {
    id: string;
    type: 'LineString';
    coordinates: [number, number][];
  }[];
  verifiedCount: number;
  lastVerifiedAt?: string;
}

export interface UserPrefs {
  requireAccessible: boolean;
  highContrast: boolean;
  largeButtons: boolean;
}

export interface QueuedAction {
  type: 'confirm' | 'correct';
  payload: unknown;
  createdAt: number;
}

export interface ToastMessage {
  id: string;
  message: string;
  tone?: 'default' | 'success' | 'warning' | 'error';
}
