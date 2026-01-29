import { v4 as uuidv4 } from 'uuid';
import {
  GameParameters,
  HourlyArrivals,
  Patient,
  PatientType,
  Room,
  RoomType,
  PlayerGameState,
  PlayerStats
} from '../types';
import { DEFAULT_PARAMETERS, ROOM_COMPATIBILITY, PATIENT_ROOM_OPTIONS } from '../data/gameConstants';

// Poisson distribution random number generator
export function poissonRandom(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;

  do {
    k++;
    p *= Math.random();
  } while (p > L);

  return k - 1;
}

// Multinomial distribution for allocating arrivals to patient types
export function multinomialSample(n: number, probs: number[]): number[] {
  const result = new Array(probs.length).fill(0);

  for (let i = 0; i < n; i++) {
    const rand = Math.random();
    let cumProb = 0;

    for (let j = 0; j < probs.length; j++) {
      cumProb += probs[j];
      if (rand < cumProb) {
        result[j]++;
        break;
      }
    }
  }

  return result;
}

// Generate arrivals for all 24 hours
export function generateArrivals(params: GameParameters): HourlyArrivals[] {
  const totalDaily = params.dailyArrivals.A + params.dailyArrivals.B + params.dailyArrivals.C;
  const typeProportions = [
    params.dailyArrivals.A / totalDaily,
    params.dailyArrivals.B / totalDaily,
    params.dailyArrivals.C / totalDaily
  ];

  const arrivals: HourlyArrivals[] = [];

  for (let hour = 1; hour <= 24; hour++) {
    const hourlyMean = totalDaily * params.hourlyWeights[hour - 1];
    const totalArrivals = poissonRandom(hourlyMean);
    const [aCount, bCount, cCount] = multinomialSample(totalArrivals, typeProportions);

    arrivals.push({
      hour,
      A: aCount,
      B: bCount,
      C: cCount
    });
  }

  return arrivals;
}

// Calculate totals from arrivals
export function calculateArrivalsTotals(arrivals: HourlyArrivals[]): { A: number; B: number; C: number; total: number } {
  const totals = arrivals.reduce(
    (acc, h) => ({
      A: acc.A + h.A,
      B: acc.B + h.B,
      C: acc.C + h.C
    }),
    { A: 0, B: 0, C: 0 }
  );

  return { ...totals, total: totals.A + totals.B + totals.C };
}

// Generate session code (6 characters)
export function generateSessionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing characters
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create a new patient
export function createPatient(type: PatientType, hour: number): Patient {
  return {
    id: uuidv4(),
    type,
    arrivedAt: hour,
    waitingTime: 0,
    status: 'arriving'
  };
}

// Create a new room
export function createRoom(type: RoomType, position: number): Room {
  return {
    id: uuidv4(),
    type,
    position,
    isOccupied: false
  };
}

// Check if a patient can be treated in a room
export function canTreatInRoom(patientType: PatientType, roomType: RoomType): boolean {
  return ROOM_COMPATIBILITY[roomType].includes(patientType);
}

// Check if treating in this room is a mismatch (not the patient's primary room type)
export function isMismatchRoom(patientType: PatientType, roomType: RoomType): boolean {
  const primaryRooms: Record<PatientType, RoomType> = {
    A: 'high',
    B: 'medium',
    C: 'low'
  };
  return primaryRooms[patientType] !== roomType;
}

// Get treatment time for a patient type
export function getTreatmentTime(patientType: PatientType, params: GameParameters = DEFAULT_PARAMETERS): number {
  return params.treatmentTimes[patientType];
}

// Roll a d20
export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

// Check if a roll triggers a risk event
export function isRiskEvent(patientType: PatientType, roll: number, params: GameParameters = DEFAULT_PARAMETERS): boolean {
  return params.riskEventRolls[patientType].includes(roll);
}

// Calculate staffing cost
export function calculateStaffingCost(rooms: Room[], params: GameParameters = DEFAULT_PARAMETERS): number {
  return rooms.reduce((total, room) => {
    return total + params.roomCosts[room.type];
  }, 0);
}

// Initialize player game state
export function initializePlayerGameState(): PlayerGameState {
  return {
    rooms: [],
    waitingRoom: [],
    completedPatients: [],
    totalRevenue: 0,
    totalCost: 0,
    staffingCost: 0,
    staffingComplete: false,
    currentPhase: 'arriving',
    hourComplete: false,
    lastCompletedHour: 0,
    lastArrivalsHour: 0,
    lastTreatmentHour: 0,
    lastSequencingHour: 0,
    stats: initializePlayerStats(),
    turnEvents: {
      arrived: { A: 0, B: 0, C: 0 },
      turnedAway: { A: 0, B: 0, C: 0 },
      riskEvents: [],
      completed: []
    }
  };
}

// Initialize player stats
export function initializePlayerStats(): PlayerStats {
  return {
    patientsTreated: { A: 0, B: 0, C: 0 },
    cardiacArrests: 0,
    lwbs: { B: 0, C: 0 },
    turnedAway: { A: 0, B: 0, C: 0 },
    waitingCosts: 0,
    riskEventCosts: 0,
    hourlyUtilization: [],
    hourlyQueueLength: [],
    maxWaitingTime: { A: 0, B: 0, C: 0 },
    mismatchTreatments: 0,
    totalTreatments: 0
  };
}

// Calculate utilization for a given hour
export function calculateUtilization(rooms: Room[]): number {
  if (rooms.length === 0) return 0;
  const occupied = rooms.filter(r => r.isOccupied).length;
  return occupied / rooms.length;
}

// Calculate average utilization
export function calculateAverageUtilization(hourlyUtilization: number[]): number {
  if (hourlyUtilization.length === 0) return 0;
  return hourlyUtilization.reduce((a, b) => a + b, 0) / hourlyUtilization.length;
}

// Calculate average queue length
export function calculateAverageQueueLength(hourlyQueueLength: number[]): number {
  if (hourlyQueueLength.length === 0) return 0;
  return hourlyQueueLength.reduce((a, b) => a + b, 0) / hourlyQueueLength.length;
}

// Calculate profit
export function calculateProfit(revenue: number, cost: number): number {
  return revenue - cost;
}

// Calculate mismatch percentage
export function calculateMismatchPercentage(mismatchTreatments: number, totalTreatments: number): number {
  if (totalTreatments === 0) return 0;
  return (mismatchTreatments / totalTreatments) * 100;
}

// Format currency
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

// Format percentage
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

// Get available room positions (0-15)
export function getAvailablePositions(rooms: Room[]): number[] {
  const occupied = new Set(rooms.map(r => r.position));
  return Array.from({ length: 16 }, (_, i) => i).filter(pos => !occupied.has(pos));
}

// Validate hourly weights sum to approximately 1
export function validateHourlyWeights(weights: number[]): boolean {
  if (weights.length !== 24) return false;
  const sum = weights.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) < 0.05; // Allow 5% tolerance
}
