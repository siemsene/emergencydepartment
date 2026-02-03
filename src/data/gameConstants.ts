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
  timeSensitiveWaitingHarms: false,
  maxWaitingRoom: 20,
  maxStaffingBudget: 42000,
  roomCosts: { high: 3900, medium: 3000, low: 1600 },
  treatmentTimes: { A: 4, B: 3, C: 2 },
  hourlyWeights: {
    A: [
      0.028, 0.034, 0.038, 0.042, 0.043, 0.046, 0.047, 0.046,
      0.048, 0.049, 0.049, 0.048, 0.048, 0.049, 0.048, 0.048,
      0.046, 0.044, 0.041, 0.037, 0.034, 0.031, 0.029, 0.027
    ],
    B: [
      0.013, 0.018, 0.022, 0.027, 0.034, 0.042, 0.051, 0.058,
      0.060, 0.062, 0.061, 0.060, 0.062, 0.061, 0.063, 0.058,
      0.055, 0.046, 0.037, 0.033, 0.026, 0.021, 0.017, 0.013
    ],
    C: [
      0.016, 0.028, 0.041, 0.053, 0.061, 0.066, 0.069, 0.070,
      0.070, 0.068, 0.065, 0.061, 0.056, 0.049, 0.043, 0.037,
      0.032, 0.026, 0.021, 0.017, 0.014, 0.013, 0.012, 0.012
    ]
  },
  currencySymbol: '$'
};

export const SUPPORTED_CURRENCIES = ['$', '€', '£', '¥', '₩', '₹'];

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
