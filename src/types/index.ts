// User Types
export type UserRole = 'admin' | 'instructor' | 'player';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export interface Instructor extends User {
  role: 'instructor';
  approved: boolean;
  approvedAt?: Date;
  approvedBy?: string;
  organization?: string;
  sessionsCreated: number;
  lastActive?: Date;
}

export interface Player {
  id: string;
  name: string;
  sessionId: string;
  joinedAt: Date;
  isConnected: boolean;
  lastSeen: Date;
  gameState: PlayerGameState;
}

// Game Configuration Types
export interface GameParameters {
  dailyArrivals: { A: number; B: number; C: number };
  revenuePerPatient: { A: number; B: number; C: number };
  waitingCostPerHour: { A: number; B: number; C: number };
  riskEventRolls: { A: number[]; B: number[]; C: number[] };
  riskEventCost: { A: number; B: number; C: number };
  timeSensitiveWaitingHarms: boolean;
  maxWaitingRoom: number;
  maxStaffingBudget: number;
  roomCosts: { high: number; medium: number; low: number };
  treatmentTimes: { A: number; B: number; C: number };
  hourlyWeights: { A: number[]; B: number[]; C: number[] };
  currencySymbol: string;
}

export interface HourlyArrivals {
  hour: number;
  A: number;
  B: number;
  C: number;
}

export interface Session {
  id: string;
  code: string;
  instructorId: string;
  name: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  expiresAt: Date;
  status: 'setup' | 'staffing' | 'sequencing' | 'completed';
  currentHour: number;
  parameters: GameParameters;
  arrivals: HourlyArrivals[];
  players: string[];
  usePregenerated: boolean;
}

// Game State Types
export type PatientType = 'A' | 'B' | 'C';
export type RoomType = 'high' | 'medium' | 'low';

export interface Patient {
  id: string;
  type: PatientType;
  arrivedAt: number; // hour when arrived
  waitingTime: number; // hours spent waiting
  treatmentProgress?: number | null; // remaining hours of treatment
  roomId?: string | null;
  status: 'arriving' | 'waiting' | 'treating' | 'treated' | 'lwbs' | 'cardiac_arrest' | 'turned_away';
  treatedInMismatchRoom?: boolean;
}

export interface Room {
  id: string;
  type: RoomType;
  position: number; // 0-15 on the board
  patient?: Patient | null;
  isOccupied: boolean;
}

export interface PlayerGameState {
  rooms: Room[];
  waitingRoom: Patient[];
  completedPatients: Patient[];
  totalRevenue: number;
  totalCost: number;
  staffingCost: number;
  staffingComplete: boolean;
  currentPhase: 'arriving' | 'sequencing' | 'rolling' | 'treating' | 'review' | 'waiting';
  hourComplete: boolean;
  lastCompletedHour: number;
  lastArrivalsHour: number; // Track which hour arrivals were last processed
  lastTreatmentHour: number; // Track which hour treatment was last processed
  lastSequencingHour: number; // Track which hour sequencing was submitted
  stats: PlayerStats;
  turnEvents: TurnEvents;
}

export interface TurnEvents {
  arrived: { A: number; B: number; C: number };
  turnedAway: { A: number; B: number; C: number };
  riskEvents: { patientId: string; type: PatientType; outcome: 'cardiac_arrest' | 'lwbs' }[];
  completed: { patientId: string; type: PatientType }[];
  waitingCosts: number;
}

export interface PlayerStats {
  patientsTreated: { A: number; B: number; C: number };
  cardiacArrests: number;
  lwbs: { B: number; C: number };
  turnedAway: { A: number; B: number; C: number };
  waitingCosts: number;
  riskEventCosts: number;
  hourlyUtilization: number[];
  hourlyQueueLength: number[];
  hourlyDemand: { A: number[]; B: number[]; C: number[] };
  hourlyAvailableCapacity: { A: number[]; B: number[]; C: number[] };
  maxWaitingTime: { A: number; B: number; C: number };
  mismatchTreatments: number;
  totalTreatments: number;
}


export interface DiceRoll {
  patientId: string;
  patientType: PatientType;
  roll: number;
  isRiskEvent: boolean;
}

// Analytics Types
export interface PlayerResult {
  playerId: string;
  playerName: string;
  totalProfit: number;
  totalRevenue: number;
  totalCost: number;
  avgUtilization: number;
  avgQueueLength: number;
  maxQueueLength: number;
  cardiacArrests: number;
  mismatchCount: number;
  mismatchPercentage: number;
  maxWaitingTime: { A: number; B: number; C: number };
  patientsTreated: { A: number; B: number; C: number };
}

export interface SessionResults {
  sessionId: string;
  completedAt: Date;
  playerResults: PlayerResult[];
  arrivals: HourlyArrivals[];
  parameters: GameParameters;
}
