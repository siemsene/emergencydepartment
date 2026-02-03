import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Session, Player, PlayerGameState, Patient, Room, PatientType, RoomType, HourlyArrivals } from '../types';
import {
  subscribeToSession,
  subscribeToPlayer,
  updatePlayerGameState,
  updatePlayerGameStateFields,
  getSession,
  advanceSessionHour,
  getSessionPlayers
} from '../services/firebaseService';
import {
  createPatient,
  createRoom,
  rollD20,
  isRiskEvent,
  getTreatmentTime,
  calculateStaffingCost,
  calculateUtilization,
  isMismatchRoom,
  canTreatInRoom,
  initializePlayerGameState
} from '../utils/gameUtils';
import { DEFAULT_PARAMETERS } from '../data/gameConstants';

interface GameContextType {
  session: Session | null;
  player: Player | null;
  gameState: PlayerGameState | null;
  isInstructor: boolean;
  setSession: (session: Session | null) => void;
  setPlayer: (player: Player | null) => void;
  setIsInstructor: (isInstructor: boolean) => void;
  // Player actions
  addRoom: (type: RoomType, position: number) => void;
  removeRoom: (roomId: string) => void;
  moveRoom: (roomId: string, newPosition: number) => void;
  completeStaffing: () => void;
  movePatientToRoom: (patientId: string, roomId: string) => void;
  movePatientBackToQueue: (patientId: string) => void;
  completeSequencing: () => void;
  // Game progression
  processArrivals: (arrivals: HourlyArrivals) => void;
  processRiskEvents: () => Promise<{ patientId: string; roll: number; isEvent: boolean; type: PatientType }[]>;
  applyRiskEventResults: (results: { patientId: string; roll: number; isEvent: boolean; type: PatientType }[]) => Promise<{ patientId: string; type: PatientType; outcome: 'cardiac_arrest' | 'lwbs' }[]>;
  processTreatment: (riskEvents?: { patientId: string; type: PatientType; outcome: 'cardiac_arrest' | 'lwbs' }[]) => void;
  completeTurn: () => void;
  resetGame: () => Promise<void>;
  // State sync
  syncGameState: () => Promise<void>;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [gameState, setGameState] = useState<PlayerGameState | null>(null);
  const [isInstructor, setIsInstructor] = useState(false);

  // Ref to track the hour for which we've processed arrivals locally
  // This prevents the Firebase subscription from overwriting our state during hour transitions
  const processedArrivalsHourRef = useRef<number>(0);

  // Timestamp-based lock to completely block subscription updates after local state changes
  // This prevents race conditions where Firebase subscription fires before React processes local updates
  const localUpdateLockUntilRef = useRef<number>(0);

  // Subscribe to session updates
  useEffect(() => {
    if (!session?.id) return;

    const unsubscribe = subscribeToSession(session.id, (updatedSession) => {
      if (updatedSession) {
        setSession(updatedSession);
      }
    });

    return () => unsubscribe();
  }, [session?.id]);

  // Subscribe to player updates
  // IMPORTANT: We use a functional update to prevent stale Firebase data from overwriting
  // newer local state. This is critical during hour transitions when multiple writes happen.
  useEffect(() => {
    if (!player?.id || isInstructor) return;

    const unsubscribe = subscribeToPlayer(player.id, (updatedPlayer) => {
      if (updatedPlayer) {
        setPlayer(updatedPlayer);
        // Use functional update to compare incoming state with current state
        setGameState(prevState => {
          if (!prevState) return updatedPlayer.gameState;

          // CRITICAL: If we're within the lock period after a local update,
          // completely ignore Firebase updates to prevent race conditions
          if (Date.now() < localUpdateLockUntilRef.current) {
            return prevState;
          }

          const incomingLastArrivals = updatedPlayer.gameState.lastArrivalsHour ?? 0;
          const currentLastArrivals = prevState.lastArrivalsHour ?? 0;

          // If we've locally processed arrivals for a higher hour than
          // what Firebase is sending, reject the Firebase update entirely.
          if (processedArrivalsHourRef.current > incomingLastArrivals) {
            return prevState;
          }

          // Also reject if incoming state has processed fewer arrivals than current local state
          if (incomingLastArrivals < currentLastArrivals) {
            return prevState;
          }

          // If same arrivals hour, check if incoming would regress the phase
          if (incomingLastArrivals === currentLastArrivals) {
            // Define phase ordering: sequencing comes after waiting/arriving
            const phaseOrder: Record<string, number> = {
              'waiting': 0,
              'arriving': 1,
              'sequencing': 2,
              'rolling': 3,
              'treating': 4,
              'review': 5
            };
            const incomingPhaseOrder = phaseOrder[updatedPlayer.gameState.currentPhase] ?? 0;
            const currentPhaseOrder = phaseOrder[prevState.currentPhase] ?? 0;

            // Don't regress to an earlier phase within the same hour
            if (incomingPhaseOrder < currentPhaseOrder) {
              return prevState;
            }
          }

          return updatedPlayer.gameState;
        });
      }
    });

    return () => unsubscribe();
  }, [player?.id, isInstructor]);

  // Initialize game state from player
  useEffect(() => {
    if (player && !gameState) {
      setGameState(player.gameState);
    }
  }, [player, gameState]);

  // Auto-advance session when player is ready and waiting
  // This ensures the game progresses even without the instructor dashboard open
  useEffect(() => {
    if (!session || !gameState || !player?.id) return;
    if (session.status !== 'sequencing') return;
    if (gameState.currentPhase !== 'waiting') return;
    if (!gameState.hourComplete) return;

    const lastCompletedHour = gameState.lastCompletedHour ?? 0;
    if (lastCompletedHour < session.currentHour) return;

    // IMPORTANT: Don't auto-advance if arrivals haven't been processed for this hour.
    // This prevents advancing when the player is still in 'waiting' from the previous hour.
    const lastArrivalsHour = gameState.lastArrivalsHour ?? 0;
    if (lastArrivalsHour < session.currentHour) return;

    // Add a delay to allow SessionMonitor to advance first (if it's running)
    // and to check that all players are ready
    const timeoutId = setTimeout(async () => {
      try {
        // Re-fetch session to check current state
        const currentSession = await getSession(session.id);
        if (!currentSession || currentSession.status !== 'sequencing') return;
        if (currentSession.currentHour !== session.currentHour) return; // Already advanced

        // Check if all players are ready (must have processed arrivals AND completed the hour)
        const allPlayers = await getSessionPlayers(session.id);
        const allReady = allPlayers.every(p => {
          const pLastCompleted = p.gameState.lastCompletedHour ?? 0;
          const pLastArrivals = p.gameState.lastArrivalsHour ?? 0;
          const pLastTreatment = p.gameState.lastTreatmentHour ?? 0;
          // Player must have processed arrivals and treatment for this hour
          return p.gameState.currentPhase === 'waiting' &&
            p.gameState.hourComplete &&
            pLastCompleted >= currentSession.currentHour &&
            pLastArrivals >= currentSession.currentHour &&
            pLastTreatment >= currentSession.currentHour;
        });

        if (allReady) {
          console.log('All players ready, advancing session to hour', currentSession.currentHour + 1);
          await advanceSessionHour(session.id, currentSession.currentHour + 1);
        }
      } catch (error) {
        console.error('Error in auto-advance:', error);
      }
    }, 2000); // 2 second delay to let SessionMonitor handle it first

    return () => clearTimeout(timeoutId);
  }, [
    session?.id,
    session?.status,
    session?.currentHour,
    gameState?.currentPhase,
    gameState?.hourComplete,
    gameState?.lastCompletedHour,
    gameState?.lastArrivalsHour,
    gameState?.lastArrivalsHour,
    player?.id
  ]);

  const syncGameState = useCallback(async () => {
    if (!player?.id || !gameState) return;
    await updatePlayerGameState(player.id, gameState);
  }, [player?.id, gameState]);

  // Staffing Actions
  const addRoom = useCallback((type: RoomType, position: number) => {
    if (!gameState || !session) return;

    const params = session.parameters || DEFAULT_PARAMETERS;
    const newRoom = createRoom(type, position);
    const newRooms = [...gameState.rooms, newRoom];
    const newStaffingCost = calculateStaffingCost(newRooms, params);

    if (newStaffingCost > params.maxStaffingBudget) {
      return; // Over budget
    }

    setGameState({
      ...gameState,
      rooms: newRooms,
      staffingCost: newStaffingCost
    });
  }, [gameState, session]);

  const removeRoom = useCallback((roomId: string) => {
    if (!gameState || !session) return;

    const params = session.parameters || DEFAULT_PARAMETERS;
    const newRooms = gameState.rooms.filter(r => r.id !== roomId);
    const newStaffingCost = calculateStaffingCost(newRooms, params);

    setGameState({
      ...gameState,
      rooms: newRooms,
      staffingCost: newStaffingCost
    });
  }, [gameState, session]);

  const moveRoom = useCallback((roomId: string, newPosition: number) => {
    if (!gameState) return;

    const newRooms = gameState.rooms.map(room => {
      if (room.id === roomId) {
        return { ...room, position: newPosition };
      }
      return room;
    });

    setGameState({
      ...gameState,
      rooms: newRooms
    });
  }, [gameState]);

  const completeStaffing = useCallback(async () => {
    if (!gameState || !player?.id) return;

    const newState = {
      ...gameState,
      staffingComplete: true,
      totalCost: gameState.staffingCost,
      hourComplete: true
    };

    setGameState(newState);
    await updatePlayerGameState(player.id, newState);
  }, [gameState, player?.id, session?.currentHour]);

  const completeTurn = useCallback(async () => {
    if (!gameState || !player?.id) return;

    const newState = {
      ...gameState,
      currentPhase: 'waiting' as const,
      hourComplete: true
    };

    setGameState(newState);
    await updatePlayerGameState(player.id, newState);
  }, [gameState, player?.id]);

  const resetGame = useCallback(async () => {
    if (!player || !session?.id) return;
    const initialGameState = initializePlayerGameState();
    await updatePlayerGameState(player.id, initialGameState);
  }, [player, session?.id]);

  // Sequencing Actions
  const processArrivals = useCallback((arrivals: HourlyArrivals) => {
    if (!gameState || !session) return;

    const currentHour = session.currentHour;

    // Prevent duplicate processing for the same hour (handle undefined for backwards compat)
    const lastArrivalsHour = gameState.lastArrivalsHour ?? 0;
    if (lastArrivalsHour >= currentHour) {
      return;
    }

    // Don't process arrivals if we're in the middle of rolling or treating
    if (gameState.currentPhase === 'rolling' || gameState.currentPhase === 'treating') {
      return;
    }

    const params = session.parameters || DEFAULT_PARAMETERS;
    const newPatients: Patient[] = [];

    // Create arriving patients
    const types: PatientType[] = ['A', 'B', 'C'];
    const arrivedCounts = { A: 0, B: 0, C: 0 };

    types.forEach(type => {
      arrivedCounts[type] = arrivals[type];
      for (let i = 0; i < arrivals[type]; i++) {
        newPatients.push(createPatient(type, currentHour));
      }
    });

    // Sort by priority (A first, then B, then C)
    newPatients.sort((a, b) => {
      const priority: Record<PatientType, number> = { A: 0, B: 1, C: 2 };
      return priority[a.type] - priority[b.type];
    });

    // Try to add to waiting room
    const waitingRoom = [...gameState.waitingRoom];
    const turnedAway: Patient[] = [];
    let newStats = { ...gameState.stats };

    // Record Demand: Previous Waiting + New Arrivals
    newStats.hourlyDemand.A.push(gameState.waitingRoom.filter(p => p.type === 'A').length + arrivals.A);
    newStats.hourlyDemand.B.push(gameState.waitingRoom.filter(p => p.type === 'B').length + arrivals.B);
    newStats.hourlyDemand.C.push(gameState.waitingRoom.filter(p => p.type === 'C').length + arrivals.C);

    // Record Available Capacity: Empty rooms of each primary type
    newStats.hourlyAvailableCapacity.A.push(gameState.rooms.filter(r => r.type === 'high' && !r.isOccupied).length);
    newStats.hourlyAvailableCapacity.B.push(gameState.rooms.filter(r => r.type === 'medium' && !r.isOccupied).length);
    newStats.hourlyAvailableCapacity.C.push(gameState.rooms.filter(r => r.type === 'low' && !r.isOccupied).length);

    newPatients.forEach(patient => {
      if (waitingRoom.length < params.maxWaitingRoom) {
        patient.status = 'waiting';
        waitingRoom.push(patient);
      } else {
        patient.status = 'turned_away';
        turnedAway.push(patient);
        newStats.turnedAway[patient.type]++;
        // Turned away patients incur risk event cost
        newStats.riskEventCosts += params.riskEventCost[patient.type];
      }
    });

    const turnedAwayCounts = {
      A: turnedAway.filter(p => p.type === 'A').length,
      B: turnedAway.filter(p => p.type === 'B').length,
      C: turnedAway.filter(p => p.type === 'C').length
    };

    const newState: PlayerGameState = {
      ...gameState,
      waitingRoom,
      totalCost: gameState.totalCost + newStats.riskEventCosts - gameState.stats.riskEventCosts,
      stats: newStats,
      currentPhase: 'sequencing',
      hourComplete: false,
      lastArrivalsHour: currentHour,
      turnEvents: {
        arrived: arrivedCounts,
        turnedAway: turnedAwayCounts,
        riskEvents: [],
        completed: [],
        waitingCosts: 0
      }
    };

    // CRITICAL: Set locks BEFORE updating state to prevent Firebase subscription
    // from overwriting our state with stale data during the transition
    processedArrivalsHourRef.current = currentHour;
    // Lock subscription updates for 2 seconds to ensure React processes our update first
    localUpdateLockUntilRef.current = Date.now() + 2000;

    // Use flushSync to force React to immediately apply the state update
    // This ensures the state is updated BEFORE the Firebase write triggers onSnapshot
    flushSync(() => {
      setGameState(newState);
    });

    if (player?.id) {
      updatePlayerGameState(player.id, newState);
    }
  }, [gameState, session, player?.id]);

  const movePatientToRoom = useCallback((patientId: string, roomId: string) => {
    if (!gameState || !session) return;
    if (gameState.currentPhase !== 'sequencing') return;

    const params = session.parameters || DEFAULT_PARAMETERS;
    const patient = gameState.waitingRoom.find(p => p.id === patientId);
    const room = gameState.rooms.find(r => r.id === roomId);

    if (!patient || !room || room.isOccupied) return;
    if (!canTreatInRoom(patient.type, room.type)) return;

    const treatmentTime = getTreatmentTime(patient.type, params);
    const updatedPatient: Patient = {
      ...patient,
      status: 'treating',
      roomId: room.id,
      treatmentProgress: treatmentTime,
      treatedInMismatchRoom: isMismatchRoom(patient.type, room.type)
    };

    const newRooms = gameState.rooms.map(r => {
      if (r.id === roomId) {
        return { ...r, isOccupied: true, patient: updatedPatient };
      }
      return r;
    });

    const newWaitingRoom = gameState.waitingRoom.filter(p => p.id !== patientId);

    setGameState({
      ...gameState,
      rooms: newRooms,
      waitingRoom: newWaitingRoom
    });
  }, [gameState, session]);

  const movePatientBackToQueue = useCallback((patientId: string) => {
    if (!gameState || !session) return;
    if (gameState.currentPhase !== 'sequencing') return;

    const room = gameState.rooms.find(r => r.patient?.id === patientId);
    if (!room || !room.patient) return;

    const params = session.parameters || DEFAULT_PARAMETERS;
    const treatmentTime = getTreatmentTime(room.patient.type, params);
    if (room.patient.treatmentProgress !== treatmentTime) return;

    const patient: Patient = {
      ...room.patient,
      status: 'waiting',
      roomId: null,
      treatmentProgress: null
    };

    const newRooms = gameState.rooms.map(r => {
      if (r.id === room.id) {
        return { ...r, isOccupied: false, patient: null };
      }
      return r;
    });

    setGameState({
      ...gameState,
      rooms: newRooms,
      waitingRoom: [...gameState.waitingRoom, patient]
    });
  }, [gameState]);

  const completeSequencing = useCallback(async () => {
    if (!gameState || !player?.id) return;
    // Only allow completing sequencing if we're actually in the sequencing phase
    if (gameState.currentPhase !== 'sequencing') return;

    // CRITICAL: Lock Firebase subscription updates BEFORE changing state
    // This prevents race conditions during the rolling/animation phase
    // Lock for 10 seconds to cover the entire sequence
    localUpdateLockUntilRef.current = Date.now() + 10000;

    const newState = {
      ...gameState,
      currentPhase: 'rolling' as const,
      lastSequencingHour: session?.currentHour ?? gameState.lastArrivalsHour ?? 0
    };

    setGameState(newState);
    await updatePlayerGameState(player.id, newState);
  }, [gameState, player?.id, session?.currentHour]);

  // Phase 1: Roll dice for risk events (doesn't remove patients yet)
  const rollForRiskEvents = useCallback(() => {
    if (!gameState || !session) return [];

    // CRITICAL: Lock Firebase subscription updates during the entire rolling/animation phase
    // This prevents stale Firebase data from overwriting our local state
    // Lock for 8 seconds to cover: 3s animation + 2.5s delay + 2s buffer
    localUpdateLockUntilRef.current = Date.now() + 8000;

    const params = session.parameters || DEFAULT_PARAMETERS;
    const results: { patientId: string; roll: number; isEvent: boolean; type: PatientType }[] = [];

    console.log('[RiskEvents] Rolling for', gameState.waitingRoom.length, 'patients');
    console.log('[RiskEvents] Risk event rolls config:', params.riskEventRolls);

    // Roll for each waiting patient
    const expandRiskRolls = (baseRolls: number[], waitingTime: number) => {
      const expanded = new Set<number>();
      const wait = Math.max(0, waitingTime);
      for (const roll of baseRolls) {
        for (let i = 0; i <= wait; i++) {
          const value = roll - i;
          if (value >= 1) expanded.add(value);
        }
      }
      return Array.from(expanded);
    };

    for (const patient of gameState.waitingRoom) {
      const roll = rollD20();
      const baseRiskRolls = params.riskEventRolls[patient.type] ?? [];
      const riskRolls = params.timeSensitiveWaitingHarms
        ? expandRiskRolls(baseRiskRolls, patient.waitingTime ?? 0)
        : baseRiskRolls;
      const isEvent = riskRolls.includes(roll);

      console.log(`[RiskEvents] Patient ${patient.type}: rolled ${roll}, riskRolls=${JSON.stringify(riskRolls)}, isEvent=${isEvent}`);

      results.push({ patientId: patient.id, roll, isEvent, type: patient.type });
    }

    const riskEventCount = results.filter(r => r.isEvent).length;
    console.log('[RiskEvents] Total risk events:', riskEventCount);

    return results;
  }, [gameState, session]);

  // Phase 2: Apply risk event results (removes patients, updates stats)
  const applyRiskEventResults = useCallback(async (
    results: { patientId: string; roll: number; isEvent: boolean; type: PatientType }[]
  ) => {
    if (!gameState || !session) {
      console.warn('[ApplyRisk] No gameState or session!');
      return [];
    }

    console.log('[ApplyRisk] Applying results for', results.length, 'patients');
    console.log('[ApplyRisk] Results with isEvent=true:', results.filter(r => r.isEvent));
    console.log('[ApplyRisk] Current waiting room size:', gameState.waitingRoom.length);
    console.log('[ApplyRisk] Waiting room patient IDs:', gameState.waitingRoom.map(p => ({ id: p.id, type: p.type })));

    const params = session.parameters || DEFAULT_PARAMETERS;
    const newRiskEvents: { patientId: string; type: PatientType; outcome: 'cardiac_arrest' | 'lwbs' }[] = [];
    let newWaitingRoom = [...gameState.waitingRoom];
    let newStats = { ...gameState.stats };
    let additionalCosts = 0;

    // Process risk events based on results
    for (const result of results) {
      if (result.isEvent) {
        console.log('[ApplyRisk] Processing risk event for patient:', result.patientId, 'type:', result.type, 'roll:', result.roll);

        const patient = newWaitingRoom.find(p => p.id === result.patientId);
        if (!patient) {
          console.warn('[ApplyRisk] Patient NOT FOUND in waiting room:', result.patientId, result.type);
          console.warn('[ApplyRisk] Available patient IDs:', newWaitingRoom.map(p => p.id));
          continue;
        }

        console.log('[ApplyRisk] Found patient:', patient.id, 'type:', patient.type);

        // Use patient.type for consistency (should match result.type)
        const patientType = patient.type;

        if (patientType === 'A') {
          // Cardiac arrest
          console.log('[ApplyRisk] Processing Type A cardiac arrest');
          newStats.cardiacArrests++;
          additionalCosts += params.riskEventCost.A;
          newRiskEvents.push({ patientId: result.patientId, type: patientType, outcome: 'cardiac_arrest' });
        } else {
          // LWBS (Left Without Being Seen)
          console.log('[ApplyRisk] Processing Type', patientType, 'LWBS');
          if (patientType === 'B') {
            newStats.lwbs.B++;
            additionalCosts += params.riskEventCost.B;
          } else {
            newStats.lwbs.C++;
            additionalCosts += params.riskEventCost.C;
          }
          newRiskEvents.push({ patientId: result.patientId, type: patientType, outcome: 'lwbs' });
        }
        newStats.riskEventCosts += params.riskEventCost[patientType];
        newWaitingRoom = newWaitingRoom.filter(p => p.id !== result.patientId);
        console.log('[ApplyRisk] Removed patient, new waiting room size:', newWaitingRoom.length);
      }
    }

    console.log('[ApplyRisk] Final newRiskEvents:', newRiskEvents);
    console.log('[ApplyRisk] Final newWaitingRoom size:', newWaitingRoom.length);

    // Increment waiting time for remaining patients
    newWaitingRoom = newWaitingRoom.map(p => ({
      ...p,
      waitingTime: p.waitingTime + 1
    }));

    // Calculate waiting costs
    const hourlyWaitingCost = newWaitingRoom.reduce((sum, p) => {
      return sum + params.waitingCostPerHour[p.type];
    }, 0);
    newStats.waitingCosts += hourlyWaitingCost;

    // Update max waiting times
    newWaitingRoom.forEach(p => {
      if (p.waitingTime > newStats.maxWaitingTime[p.type]) {
        newStats.maxWaitingTime[p.type] = p.waitingTime;
      }
    });

    const newState = {
      ...gameState,
      waitingRoom: newWaitingRoom,
      totalCost: gameState.totalCost + additionalCosts + hourlyWaitingCost,
      stats: newStats,
      currentPhase: 'treating' as const,
      lastSequencingHour: Math.max(gameState.lastSequencingHour ?? 0, session.currentHour),
      turnEvents: {
        ...gameState.turnEvents,
        riskEvents: newRiskEvents,
        waitingCosts: hourlyWaitingCost
      }
    };

    console.log('[ApplyRisk] Setting new state with turnEvents.riskEvents:', newState.turnEvents.riskEvents);
    console.log('[ApplyRisk] New state cardiacArrests:', newState.stats.cardiacArrests);

    setGameState(newState);
    if (player?.id) {
      await updatePlayerGameState(player.id, newState);
    }

    // Return the risk events so they can be passed to processTreatment
    return newRiskEvents;
  }, [gameState, session, player?.id]);

  // Legacy function for compatibility - just rolls, doesn't apply
  const processRiskEvents = useCallback(async () => {
    return rollForRiskEvents();
  }, [rollForRiskEvents]);

  const processTreatment = useCallback(async (riskEvents?: { patientId: string; type: PatientType; outcome: 'cardiac_arrest' | 'lwbs' }[]) => {
    if (!gameState || !session) return;

    const treatmentHour = gameState.lastArrivalsHour ?? session.currentHour;

    // Prevent duplicate processing for the same hour (handle undefined for backwards compat)
    const lastTreatmentHour = gameState.lastTreatmentHour ?? 0;
    if (lastTreatmentHour >= treatmentHour) {
      // Already processed, but ensure we're in waiting state
      if (gameState.currentPhase !== 'waiting' || !gameState.hourComplete) {
        const fixState = {
          ...gameState,
          currentPhase: 'waiting' as const,
          hourComplete: true,
          lastCompletedHour: treatmentHour
        };
        setGameState(fixState);
        if (player?.id) {
          await updatePlayerGameStateFields(player.id, {
            currentPhase: 'waiting',
            hourComplete: true,
            lastCompletedHour: treatmentHour
          });
        }
      }
      return;
    }

    const params = session.parameters || DEFAULT_PARAMETERS;
    let newRooms = [...gameState.rooms];
    let newCompletedPatients = [...gameState.completedPatients];
    let newCompletedList: { patientId: string; type: PatientType }[] = [];
    let newStats = { ...gameState.stats };
    let additionalRevenue = 0;

    // Process each room
    newRooms = newRooms.map(room => {
      if (!room.patient) {
        if (room.isOccupied) {
          return { ...room, isOccupied: false };
        }
        return room;
      }

      const currentProgress =
        room.patient.treatmentProgress ?? getTreatmentTime(room.patient.type, params);
      const newProgress = currentProgress - 1;

      if (newProgress <= 0) {
        // Patient treated
        const completedPatient: Patient = {
          ...room.patient,
          status: 'treated',
          treatmentProgress: 0,
          roomId: null
        };
        newCompletedPatients.push(completedPatient);
        newStats.patientsTreated[room.patient.type]++;
        newStats.totalTreatments++;
        if (room.patient.treatedInMismatchRoom) {
          newStats.mismatchTreatments++;
        }
        additionalRevenue += params.revenuePerPatient[room.patient.type];

        newCompletedList.push({
          patientId: room.patient.id,
          type: room.patient.type
        });

        return { ...room, isOccupied: false, patient: null };
      }

      return {
        ...room,
        isOccupied: true,
        patient: { ...room.patient, treatmentProgress: newProgress }
      };
    });

    // Record hourly stats
    const utilization = calculateUtilization(newRooms);
    newStats.hourlyUtilization.push(utilization);
    newStats.hourlyQueueLength.push(gameState.waitingRoom.length);

    const newState: PlayerGameState = {
      ...gameState,
      rooms: newRooms,
      completedPatients: newCompletedPatients,
      totalRevenue: gameState.totalRevenue + additionalRevenue,
      stats: newStats,
      currentPhase: 'review' as const,
      hourComplete: false,
      lastCompletedHour: treatmentHour,
      lastTreatmentHour: treatmentHour,
      turnEvents: {
        ...gameState.turnEvents,
        // Use passed riskEvents if provided (to avoid stale closure issue)
        riskEvents: riskEvents ?? gameState.turnEvents.riskEvents,
        completed: newCompletedList
      }
    };

    setGameState(newState);
    if (player?.id) {
      try {
        await updatePlayerGameState(player.id, newState);
      } catch (error) {
        console.error('Error writing treatment state to Firebase:', error);
      }
    }
  }, [gameState, session, player?.id]);

  return (
    <GameContext.Provider
      value={{
        session,
        player,
        gameState,
        isInstructor,
        setSession,
        setPlayer,
        setIsInstructor,
        addRoom,
        removeRoom,
        moveRoom,
        completeStaffing,
        movePatientToRoom,
        movePatientBackToQueue,
        completeSequencing,
        processArrivals,
        processRiskEvents,
        applyRiskEventResults,
        processTreatment,
        completeTurn,
        resetGame,
        syncGameState
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}
