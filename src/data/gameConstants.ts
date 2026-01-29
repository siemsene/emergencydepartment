import { GameParameters, HourlyArrivals } from '../types';

export const DEFAULT_PARAMETERS: GameParameters = {
  dailyArrivals: { A: 21, B: 38, C: 41 },
  revenuePerPatient: { A: 2000, B: 1200, C: 500 },
  waitingCostPerHour: { A: 250, B: 100, C: 25 },
  riskEventRolls: {
    A: [19, 20],
    B: [20],
    C: [18, 19, 20]
  },
  riskEventCost: { A: 10000, B: 300, C: 200 },
  maxWaitingRoom: 15,
  maxStaffingBudget: 42000,
  roomCosts: { high: 3900, medium: 3000, low: 1600 },
  treatmentTimes: { A: 4, B: 3, C: 2 },
  hourlyWeights: [
    0.0097, 0.0172, 0.0419, 0.0604, 0.0706, 0.0718,
    0.0693, 0.0657, 0.0630, 0.0598, 0.0599, 0.0599,
    0.0588, 0.0559, 0.0509, 0.0415, 0.0339, 0.0276,
    0.0213, 0.0166, 0.0130, 0.0111, 0.0100, 0.0097
  ]
};

// Hours of the day starting at 6 AM
export const HOURS_OF_DAY = [
  '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM',
  '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM',
  '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM',
  '12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM'
];

export const ROOM_COLORS = {
  high: '#dc2626', // red
  medium: '#eab308', // yellow
  low: '#2563eb' // blue
};

export const PATIENT_COLORS = {
  A: '#dc2626', // red
  B: '#eab308', // yellow
  C: '#2563eb' // blue
};

export const PATIENT_TYPE_NAMES = {
  A: 'High Acuity',
  B: 'Medium Acuity',
  C: 'Low Acuity'
};

export const ROOM_TYPE_NAMES = {
  high: 'High Acuity Room',
  medium: 'Medium Acuity Room',
  low: 'Low Acuity Room'
};

// Which patient types can be treated in which room types
export const ROOM_COMPATIBILITY: Record<string, string[]> = {
  high: ['A', 'B', 'C'],
  medium: ['B', 'C'],
  low: ['C']
};

// Which room types can treat which patient types
export const PATIENT_ROOM_OPTIONS: Record<string, string[]> = {
  A: ['high'],
  B: ['high', 'medium'],
  C: ['high', 'medium', 'low']
};
