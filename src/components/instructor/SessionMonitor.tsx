import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Session, Player, Room, Patient, PatientType, RoomType, GameParameters } from '../../types';
import {
  getSession,
  subscribeToSession,
  subscribeToSessionPlayers,
  advanceSessionToSequencing,
  advanceSessionHour,
  endSessionEarly,
  pauseSession,
  cancelPauseSession,
  resumeSession,
  nudgePlayer,
  kickPlayer,
  updatePlayerGameState,
  updatePlayerGameStateFields
} from '../../services/firebaseService';
import { formatCurrency, calculateProfit, getTreatmentTime, calculateUtilization, rollD20, getEffectiveHour } from '../../utils/gameUtils';
import { HOURS_OF_DAY, DEFAULT_PARAMETERS } from '../../data/gameConstants';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import './SessionMonitor.css';

export function SessionMonitor() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [kickPlayerId, setKickPlayerId] = useState<string | null>(null);
  const [nudgePlayerId, setNudgePlayerId] = useState<string | null>(null);
  const [endingPlayerId, setEndingPlayerId] = useState<string | null>(null);
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const advancingRef = useRef(false);
  const lastHourRef = useRef<number | null>(null);
  const lastHourChangeAtRef = useRef<number>(0);

  useEffect(() => {
    if (!sessionId) return;

    // Initial load
    getSession(sessionId).then(s => {
      setSession(s);
      setIsLoading(false);
    });

    // Subscribe to session updates
    const unsubSession = subscribeToSession(sessionId, (updatedSession) => {
      setSession(updatedSession);
    });

    // Subscribe to player updates
    const unsubPlayers = subscribeToSessionPlayers(sessionId, (updatedPlayers) => {
      setPlayers(updatedPlayers);
    });

    return () => {
      unsubSession();
      unsubPlayers();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!session || session.status !== 'sequencing') return;
    if (lastHourRef.current !== session.currentHour) {
      lastHourRef.current = session.currentHour;
      lastHourChangeAtRef.current = Date.now();
    }
  }, [session]);

  // Automatically navigate to results when session completes
  useEffect(() => {
    if (session?.status === 'completed' && sessionId) {
      navigate(`/instructor/session/${sessionId}/results`);
    }
  }, [session?.status, sessionId, navigate]);

  const allPlayersReady = useCallback(() => {
    if (players.length === 0) return false;
    // In async mode, no session-level auto-advance — each player advances themselves
    if (session?.asyncMode) return false;

    if (session?.status === 'staffing') {
      return players.every(p => p.gameState.staffingComplete);
    }

    if (session?.status === 'sequencing') {
      return players.every(p => {
        const lastCompleted = p.gameState.lastCompletedHour ?? 0;
        const lastArrivals = p.gameState.lastArrivalsHour ?? 0;
        const lastTreatment = p.gameState.lastTreatmentHour ?? 0;
        const lastSequencing = p.gameState.lastSequencingHour ?? 0;
        // Player must have processed arrivals for this hour AND completed it
        // This prevents advancing when players are still in 'waiting' from previous hour
        return p.gameState.currentPhase === 'waiting' &&
          p.gameState.hourComplete &&
          lastCompleted >= session.currentHour &&
          lastArrivals >= session.currentHour &&
          lastTreatment >= session.currentHour &&
          lastSequencing >= session.currentHour;
      });
    }

    return false;
  }, [players, session?.status, session?.currentHour, session?.asyncMode]);

  const handleAdvanceGame = useCallback(async () => {
    if (!sessionId || !session) return;
    if (advancingRef.current) return;
    if (session.status !== 'staffing' && session.status !== 'sequencing') return;

    advancingRef.current = true;
    try {
      if (session.status === 'staffing') {
        await advanceSessionToSequencing(sessionId);
      } else if (session.status === 'sequencing') {
        await advanceSessionHour(sessionId, session.currentHour + 1);
      }
    } catch (error) {
      console.error('Error advancing game:', error);
    } finally {
      advancingRef.current = false;
    }
  }, [sessionId, session]);

  const handleKickPlayer = async () => {
    if (!kickPlayerId) return;
    await kickPlayer(kickPlayerId);
    setKickPlayerId(null);
  };

  const handleEndSessionEarly = async () => {
    if (!sessionId) return;
    setIsEndingSession(true);
    try {
      await endSessionEarly(sessionId);
    } catch (error) {
      console.error('Error ending session early:', error);
    } finally {
      setIsEndingSession(false);
      setShowEndSessionModal(false);
    }
  };

  const handleNudgePlayer = async (playerId: string) => {
    await nudgePlayer(playerId);
    setNudgePlayerId(playerId);
    setTimeout(() => setNudgePlayerId(null), 3000);
  };

  // Strip undefined values from an object (Firestore rejects undefined)
  const stripUndefined = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) return null;
    if (Array.isArray(obj)) return obj.map(stripUndefined);
    if (typeof obj === 'object') {
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (value !== undefined) cleaned[key] = stripUndefined(value);
      }
      return cleaned;
    }
    return obj;
  };

  const autoSequencePatients = (
    currentRooms: Room[],
    currentWaitingRoom: Patient[],
    params: GameParameters
  ): { rooms: Room[]; waitingRoom: Patient[] } => {
    const primaryMapping: Record<PatientType, RoomType> = { A: 'high', B: 'medium', C: 'low' };
    const rooms = currentRooms.map(r => ({ ...r, patient: r.patient ? { ...r.patient } : r.patient }));
    let waitingRoom = [...currentWaitingRoom];

    for (const type of ['A', 'B', 'C'] as PatientType[]) {
      const roomType = primaryMapping[type];
      const waitingOfType = waitingRoom.filter(p => p.type === type);
      const freeRooms = rooms.filter(r => r.type === roomType && !r.isOccupied);

      const count = Math.min(waitingOfType.length, freeRooms.length);
      for (let i = 0; i < count; i++) {
        const patient = { ...waitingOfType[i] };
        patient.status = 'treating' as const;
        patient.treatmentProgress = getTreatmentTime(type, params);
        patient.treatedInMismatchRoom = false;
        freeRooms[i].isOccupied = true;
        freeRooms[i].patient = patient;
        waitingRoom = waitingRoom.filter(p => p.id !== patient.id);
      }
    }

    return { rooms, waitingRoom };
  };

  const handleForceEndDecision = async (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player || !session) return;
    setEndingPlayerId(playerId);
    try {
    const gs = player.gameState;
    console.log('[ForceEnd] Player:', player.name, 'Phase:', gs.currentPhase,
      'Session status:', session.status, 'Async:', session.asyncMode,
      'Version:', gs.stateVersion, 'LocalHour:', gs.currentHour,
      'SessionHour:', session.currentHour);

    if (session.asyncMode) {
      const newVersion = (player.gameState.stateVersion ?? 0) + 100;
      if (!player.gameState.staffingComplete) {
        // Force complete staffing in async mode
        await updatePlayerGameStateFields(playerId, {
          staffingComplete: true,
          totalCost: player.gameState.staffingCost,
          currentHour: 1,
          currentPhase: 'arriving',
          hourComplete: false,
          stateVersion: newVersion
        });
      } else {
        // Force complete the player's current hour in async mode
        const playerHour = player.gameState.currentHour ?? 0;
        const currentPhase = player.gameState.currentPhase;
        const params = session.parameters || DEFAULT_PARAMETERS;
        const gs = player.gameState;

        if (currentPhase === 'waiting') {
          // Already done — advance to next hour
          await updatePlayerGameStateFields(playerId, {
            currentPhase: 'arriving',
            hourComplete: playerHour >= 24,
            currentHour: Math.min(playerHour + 1, 24),
            lastCompletedHour: playerHour,
            stateVersion: newVersion
          });
        } else if (currentPhase === 'review') {
          // Past treatment — advance to next hour
          await updatePlayerGameStateFields(playerId, {
            currentPhase: 'arriving',
            hourComplete: playerHour >= 24,
            currentHour: Math.min(playerHour + 1, 24),
            lastCompletedHour: playerHour,
            stateVersion: newVersion
          });
        } else {
          // Full round processing for async mode (same as sync but advances hour)
          const { rooms: allocatedRooms, waitingRoom: allocatedWaiting } = autoSequencePatients(
            gs.rooms, gs.waitingRoom, params
          );
          const utilization = calculateUtilization(allocatedRooms);
          let waitingRoom = [...allocatedWaiting];
          const stats = JSON.parse(JSON.stringify(gs.stats));
          let additionalCosts = 0;

          const expandRiskRolls = (baseRolls: number[], waitingTime: number) => {
            const expanded = new Set<number>();
            for (const roll of baseRolls) {
              for (let i = 0; i <= Math.max(0, waitingTime); i++) {
                const value = roll - i;
                if (value >= 1) expanded.add(value);
              }
            }
            return Array.from(expanded);
          };

          for (const patient of [...waitingRoom]) {
            const roll = rollD20();
            const baseRiskRolls = params.riskEventRolls[patient.type] ?? [];
            const riskRolls = params.timeSensitiveWaitingHarms
              ? expandRiskRolls(baseRiskRolls, patient.waitingTime ?? 0)
              : baseRiskRolls;
            if (riskRolls.includes(roll)) {
              if (patient.type === 'A') {
                stats.cardiacArrests++;
                additionalCosts += params.riskEventCost.A;
              } else if (patient.type === 'B') {
                stats.lwbs.B++;
                additionalCosts += params.riskEventCost.B;
              } else {
                stats.lwbs.C++;
                additionalCosts += params.riskEventCost.C;
              }
              stats.riskEventCosts += params.riskEventCost[patient.type];
              waitingRoom = waitingRoom.filter(p => p.id !== patient.id);
            }
          }

          waitingRoom = waitingRoom.map(p => ({
            ...p,
            waitingTime: (p.waitingTime ?? 0) + 1
          }));
          const hourlyWaitingCost = waitingRoom.reduce((sum, p) => sum + params.waitingCostPerHour[p.type], 0);
          stats.waitingCosts += hourlyWaitingCost;
          for (const p of waitingRoom) {
            if (p.waitingTime > stats.maxWaitingTime[p.type]) {
              stats.maxWaitingTime[p.type] = p.waitingTime;
            }
          }

          let rooms = [...allocatedRooms];
          let completedPatients = [...gs.completedPatients];
          let additionalRevenue = 0;
          rooms = rooms.map(room => {
            if (!room.patient) return room.isOccupied ? { ...room, isOccupied: false } : room;
            const progress = room.patient.treatmentProgress ?? getTreatmentTime(room.patient.type, params);
            const newProgress = progress - 1;
            if (newProgress <= 0) {
              const completed = { ...room.patient, status: 'treated' as const, treatmentProgress: 0, roomId: null };
              completedPatients.push(completed);
              stats.patientsTreated[room.patient.type]++;
              stats.totalTreatments++;
              if (room.patient.treatedInMismatchRoom) stats.mismatchTreatments++;
              additionalRevenue += params.revenuePerPatient[room.patient.type];
              return { ...room, isOccupied: false, patient: null };
            }
            return { ...room, patient: { ...room.patient, treatmentProgress: newProgress } };
          });

          stats.hourlyUtilization.push(utilization);
          stats.hourlyQueueLength.push(allocatedWaiting.length);

          const nextHour = Math.min(playerHour + 1, 24);
          const newGameState = {
            ...gs,
            rooms,
            waitingRoom,
            completedPatients,
            totalRevenue: gs.totalRevenue + additionalRevenue,
            totalCost: gs.totalCost + additionalCosts + hourlyWaitingCost,
            stats,
            currentPhase: 'arriving' as const,
            hourComplete: playerHour >= 24,
            currentHour: nextHour,
            lastArrivalsHour: playerHour,
            lastSequencingHour: playerHour,
            lastTreatmentHour: playerHour,
            lastCompletedHour: playerHour,
            stateVersion: newVersion
          };
          await updatePlayerGameState(playerId, stripUndefined(newGameState) as typeof newGameState);
        }
      }
    } else if (session.status === 'staffing') {
      // Force complete staffing: preserve their current room choices
      const newVersion = (player.gameState.stateVersion ?? 0) + 100;
      await updatePlayerGameStateFields(playerId, {
        staffingComplete: true,
        totalCost: player.gameState.staffingCost,
        hourComplete: true,
        stateVersion: newVersion
      });
    } else {
      // Force complete the current game hour — do full round processing server-side
      const params = session.parameters || DEFAULT_PARAMETERS;
      const gs = player.gameState;
      const currentPhase = gs.currentPhase;
      const newVersion = (gs.stateVersion ?? 0) + 100;

      if (currentPhase === 'waiting') {
        // Already done — just ensure marked complete
        await updatePlayerGameStateFields(playerId, {
          hourComplete: true,
          lastCompletedHour: session.currentHour,
          stateVersion: newVersion
        });
      } else if (currentPhase === 'review') {
        // Past treatment — mark as waiting/complete
        await updatePlayerGameStateFields(playerId, {
          currentPhase: 'waiting',
          hourComplete: true,
          lastCompletedHour: session.currentHour,
          stateVersion: newVersion
        });
      } else {
        // Player is in arriving/sequencing/rolling/treating
        // Do full round processing: auto-allocate → risk events → treatment → stats

        // 1. Auto-allocate patients to rooms
        const { rooms: allocatedRooms, waitingRoom: allocatedWaiting } = autoSequencePatients(
          gs.rooms, gs.waitingRoom, params
        );

        // 2. Record utilization after allocation
        const utilization = calculateUtilization(allocatedRooms);

        // 3. Process risk events for waiting patients
        let waitingRoom = [...allocatedWaiting];
        const stats = JSON.parse(JSON.stringify(gs.stats));
        let additionalCosts = 0;

        const expandRiskRolls = (baseRolls: number[], waitingTime: number) => {
          const expanded = new Set<number>();
          for (const roll of baseRolls) {
            for (let i = 0; i <= Math.max(0, waitingTime); i++) {
              const value = roll - i;
              if (value >= 1) expanded.add(value);
            }
          }
          return Array.from(expanded);
        };

        for (const patient of [...waitingRoom]) {
          const roll = rollD20();
          const baseRiskRolls = params.riskEventRolls[patient.type] ?? [];
          const riskRolls = params.timeSensitiveWaitingHarms
            ? expandRiskRolls(baseRiskRolls, patient.waitingTime ?? 0)
            : baseRiskRolls;
          if (riskRolls.includes(roll)) {
            if (patient.type === 'A') {
              stats.cardiacArrests++;
              additionalCosts += params.riskEventCost.A;
            } else if (patient.type === 'B') {
              stats.lwbs.B++;
              additionalCosts += params.riskEventCost.B;
            } else {
              stats.lwbs.C++;
              additionalCosts += params.riskEventCost.C;
            }
            stats.riskEventCosts += params.riskEventCost[patient.type];
            waitingRoom = waitingRoom.filter(p => p.id !== patient.id);
          }
        }

        // 4. Increment waiting time & calculate waiting costs
        waitingRoom = waitingRoom.map(p => ({
          ...p,
          waitingTime: (p.waitingTime ?? 0) + 1
        }));
        const hourlyWaitingCost = waitingRoom.reduce((sum, p) => sum + params.waitingCostPerHour[p.type], 0);
        stats.waitingCosts += hourlyWaitingCost;

        // Update max waiting times
        for (const p of waitingRoom) {
          if (p.waitingTime > stats.maxWaitingTime[p.type]) {
            stats.maxWaitingTime[p.type] = p.waitingTime;
          }
        }

        // 5. Process treatment — advance rooms
        let rooms = [...allocatedRooms];
        let completedPatients = [...gs.completedPatients];
        let additionalRevenue = 0;

        rooms = rooms.map(room => {
          if (!room.patient) return room.isOccupied ? { ...room, isOccupied: false } : room;
          const progress = room.patient.treatmentProgress ?? getTreatmentTime(room.patient.type, params);
          const newProgress = progress - 1;
          if (newProgress <= 0) {
            const completed = { ...room.patient, status: 'treated' as const, treatmentProgress: 0, roomId: null };
            completedPatients.push(completed);
            stats.patientsTreated[room.patient.type]++;
            stats.totalTreatments++;
            if (room.patient.treatedInMismatchRoom) stats.mismatchTreatments++;
            additionalRevenue += params.revenuePerPatient[room.patient.type];
            return { ...room, isOccupied: false, patient: null };
          }
          return { ...room, patient: { ...room.patient, treatmentProgress: newProgress } };
        });

        // 6. Record hourly stats
        stats.hourlyUtilization.push(utilization);
        stats.hourlyQueueLength.push(allocatedWaiting.length);

        // 7. Write complete game state
        const newGameState = {
          ...gs,
          rooms,
          waitingRoom,
          completedPatients,
          totalRevenue: gs.totalRevenue + additionalRevenue,
          totalCost: gs.totalCost + additionalCosts + hourlyWaitingCost,
          stats,
          currentPhase: 'waiting' as const,
          hourComplete: true,
          lastArrivalsHour: session.currentHour,
          lastSequencingHour: session.currentHour,
          lastTreatmentHour: session.currentHour,
          lastCompletedHour: session.currentHour,
          stateVersion: newVersion
        };
        await updatePlayerGameState(playerId, stripUndefined(newGameState) as typeof newGameState);
      }
    }
    console.log('[ForceEnd] Success for player:', player.name);
    } catch (error) {
      console.error('[ForceEnd] Error forcing end decision:', error);
    } finally {
      setTimeout(() => setEndingPlayerId(null), 2000);
    }
  };

  const handlePauseSession = async () => {
    if (!sessionId) return;
    try { await pauseSession(sessionId); } catch (e) { console.error('Pause failed:', e); }
  };

  const handleCancelPause = async () => {
    if (!sessionId) return;
    try { await cancelPauseSession(sessionId); } catch (e) { console.error('Cancel pause failed:', e); }
  };

  const handleResumeSession = async () => {
    if (!sessionId) return;
    try { await resumeSession(sessionId); } catch (e) { console.error('Resume failed:', e); }
  };

  useEffect(() => {
    if (!session || !sessionId) return;
    if (session.asyncMode) return; // No auto-advance in async mode
    if (session.status !== 'staffing' && session.status !== 'sequencing') return;
    if (!allPlayersReady()) return;
    if (session.status === 'sequencing' && Date.now() - lastHourChangeAtRef.current < 1000) return;

    handleAdvanceGame();
  }, [allPlayersReady, handleAdvanceGame, session, sessionId]);

  // Rescue stuck players - only intervene for clearly stuck states
  // This runs periodically to help players who got stuck due to race conditions
  useEffect(() => {
    if (!session || session.status !== 'sequencing') return;

    const rescueStuckPlayers = async () => {
      for (const player of players) {
        const lastTreatmentHour = player.gameState.lastTreatmentHour ?? 0;
        const lastCompletedHour = player.gameState.lastCompletedHour ?? 0;
        const lastArrivalsHour = player.gameState.lastArrivalsHour ?? 0;
        const lastSequencingHour = player.gameState.lastSequencingHour ?? 0;

        // In async mode, use player's own hour; in sync mode, use session hour
        const effectiveHour = session.asyncMode
          ? (player.gameState.currentHour ?? 0)
          : session.currentHour;

        // Skip players that haven't started yet (async: still staffing)
        if (session.asyncMode && !player.gameState.staffingComplete) continue;
        // Skip players that have finished all 24 hours
        if (session.asyncMode && lastCompletedHour >= 24) continue;

        // IMPORTANT: Don't rescue 'waiting' phase if arrivals haven't been processed yet.
        // This prevents incorrectly marking the player as complete for a new hour
        // when they're still in 'waiting' from the previous hour.
        const arrivalsProcessedForCurrentHour = lastArrivalsHour >= effectiveHour;
        const sequencingSubmittedForCurrentHour = lastSequencingHour >= effectiveHour;

        // Player is in 'waiting' phase but hourComplete is false - set it to true
        // Only do this if arrivals have been processed (meaning they actually went through this hour)
        if (
          player.gameState.currentPhase === 'waiting' &&
          !player.gameState.hourComplete &&
          arrivalsProcessedForCurrentHour &&
          sequencingSubmittedForCurrentHour &&
          lastTreatmentHour < effectiveHour
        ) {
          await updatePlayerGameStateFields(player.id, {
            hourComplete: true,
            lastCompletedHour: effectiveHour,
            lastTreatmentHour: effectiveHour
          });
          continue;
        }

        // Player is in 'waiting' phase with hourComplete true but lastCompletedHour is behind
        // Only rescue if arrivals have been processed for this hour
        if (
          player.gameState.currentPhase === 'waiting' &&
          player.gameState.hourComplete &&
          lastCompletedHour < effectiveHour &&
          arrivalsProcessedForCurrentHour &&
          sequencingSubmittedForCurrentHour &&
          lastTreatmentHour < effectiveHour
        ) {
          await updatePlayerGameStateFields(player.id, {
            lastCompletedHour: effectiveHour,
            lastTreatmentHour: effectiveHour
          });
          continue;
        }

        // Player is stuck in 'treating' phase with no active treatments
        // Only rescue if treatment hasn't been processed for this hour yet
        if (player.gameState.currentPhase === 'treating' && lastTreatmentHour < effectiveHour) {
          const hasActiveTreatment = player.gameState.rooms.some(
            room => room.isOccupied && room.patient && (room.patient.treatmentProgress || 0) > 0
          );

          // Only rescue if there's genuinely no active treatment
          // This means either no patients in rooms, or all patients have completed (treatmentProgress <= 0)
          if (!hasActiveTreatment) {
            await updatePlayerGameStateFields(player.id, {
              currentPhase: 'waiting',
              hourComplete: true,
              lastCompletedHour: effectiveHour,
              lastTreatmentHour: effectiveHour
            });
          }
        }
      }
    };

    // Run rescue with a longer delay to avoid interfering with normal game flow
    // Normal treatment processing takes about 5 seconds (3s dice + 2s delay)
    const timeoutId = setTimeout(rescueStuckPlayers, 6000);
    return () => clearTimeout(timeoutId);
  }, [players, session?.currentHour, session?.status]);

  if (isLoading) {
    return <div className="monitor-loading">Loading session...</div>;
  }

  if (!session) {
    return <div className="monitor-error">Session not found</div>;
  }

  const getPlayerStatus = (player: Player) => {
    if (session.asyncMode) {
      // Async mode: show per-player progress
      if (!player.gameState.staffingComplete) return 'Staffing...';
      const playerHour = player.gameState.currentHour ?? 0;
      const lastCompleted = player.gameState.lastCompletedHour ?? 0;
      if (lastCompleted >= 24) return 'Finished (24/24)';
      return `Hour ${playerHour}/24 - ${player.gameState.currentPhase}`;
    }

    if (session.status === 'staffing') {
      return player.gameState.staffingComplete ? 'Ready' : 'Staffing...';
    }
    if (session.status === 'sequencing') {
      // Check if player has actually completed the CURRENT hour, not just any hour
      const lastArrivals = player.gameState.lastArrivalsHour ?? 0;
      const lastCompleted = player.gameState.lastCompletedHour ?? 0;

      // If arrivals haven't been processed for this hour, player is still starting
      if (lastArrivals < session.currentHour) {
        return 'Starting...';
      }

      // Player is truly ready only if they completed the current hour
      if (player.gameState.hourComplete && lastCompleted >= session.currentHour) {
        return 'Ready';
      }

      return player.gameState.currentPhase;
    }
    return 'Waiting';
  };

  return (
    <div className="session-monitor">
      <header className="monitor-header">
        <div className="header-left">
          <Button variant="secondary" size="small" onClick={() => navigate('/instructor/dashboard')}>
            &larr; Back
          </Button>
          <h1>{session.name}</h1>
          <span className="session-code">Code: <strong>{session.code}</strong></span>
        </div>
        <div className="header-right">
          <div className={`status-indicator ${session.status}`}>
            {session.asyncMode && session.status === 'sequencing' ? 'Async Mode' :
              session.status === 'paused' ? `PAUSED — Hour ${session.currentHour} Complete` :
              session.status === 'staffing' ? 'Staffing Phase' :
              session.status === 'sequencing' ? `Hour ${session.currentHour}: ${HOURS_OF_DAY[session.currentHour - 1] || ''}${session.pauseAfterTurn ? ' (Pausing...)' : ''}` :
                session.status === 'completed' ? 'Completed' : 'Setup'}
          </div>
          {session.status === 'sequencing' && !session.pauseAfterTurn && !session.asyncMode && (
            <Button variant="secondary" size="small" onClick={handlePauseSession}>
              Pause
            </Button>
          )}
          {session.status === 'sequencing' && session.pauseAfterTurn && (
            <Button variant="secondary" size="small" onClick={handleCancelPause}>
              Cancel Pause
            </Button>
          )}
          {session.status === 'paused' && (
            <Button variant="primary" size="small" onClick={handleResumeSession}>
              Resume Game
            </Button>
          )}
          <Button
            variant="danger"
            size="small"
            onClick={() => setShowEndSessionModal(true)}
            disabled={session.status === 'completed'}
          >
            End Session
          </Button>
        </div>
      </header>

      <div className="monitor-content">
        <div className="progress-section">
          <h2>Game Progress</h2>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${session.status === 'completed' ? 100 :
                  session.asyncMode && session.status === 'sequencing' && players.length > 0
                    ? (players.reduce((sum, p) => sum + (p.gameState.lastCompletedHour ?? 0), 0) / players.length / 24) * 100
                    : session.status === 'sequencing' ? (session.currentHour / 24) * 100 :
                    session.status === 'staffing' ? 0 : 0}%`
              }}
            />
          </div>
          <div className="progress-labels">
            {[
              { label: 'Staffing', percent: 0, align: 'start' },
              { label: 'Hour 6', percent: (6 / 24) * 100, align: 'middle' },
              { label: 'Hour 12', percent: (12 / 24) * 100, align: 'middle' },
              { label: 'Hour 24', percent: 100, align: 'end' }
            ].map((item) => (
              <span
                key={item.label}
                className={`progress-label ${item.align}`}
                style={{ left: `${item.percent}%` }}
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>

        <div className="players-section">
          <div className="section-header">
            <h2>Players ({players.length})</h2>
          </div>

          <div className="players-table">
            <div className="table-header">
              <span>Name</span>
              <span>Status</span>
              <span>Connected</span>
              <span>Profit</span>
              <span>Queue</span>
              <span>Actions</span>
            </div>

            <AnimatePresence>
              {players.map((player) => {
                const profit = calculateProfit(
                  player.gameState.totalRevenue,
                  player.gameState.totalCost
                );
                // Check if player is truly ready
                const lastArrivals = player.gameState.lastArrivalsHour ?? 0;
                const lastCompleted = player.gameState.lastCompletedHour ?? 0;
                const isReady = session.asyncMode
                  ? lastCompleted >= 24
                  : session.status === 'staffing'
                    ? player.gameState.staffingComplete
                    : (player.gameState.hourComplete &&
                      lastArrivals >= session.currentHour &&
                      lastCompleted >= session.currentHour);

                return (
                  <motion.div
                    key={player.id}
                    className={`table-row ${isReady ? 'ready' : ''} ${nudgePlayerId === player.id ? 'nudged' : ''}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <span className="player-name">{player.name}</span>
                    <span className={`player-status ${isReady ? 'ready' : 'pending'}`}>
                      {getPlayerStatus(player)}
                    </span>
                    <span className={`connection-status ${player.isConnected ? 'connected' : 'disconnected'}`}>
                      {player.isConnected ? 'Online' : 'Offline'}
                    </span>
                    <span className={`profit-value ${profit >= 0 ? 'positive' : 'negative'}`}>
                      {formatCurrency(profit, session.parameters.currencySymbol || '$')}
                    </span>
                    <span className="queue-count">
                      {player.gameState.waitingRoom.length}
                    </span>
                    <div className="player-actions">
                      {nudgePlayerId === player.id && (
                        <span className="nudge-feedback">Player nudged</span>
                      )}
                      {endingPlayerId === player.id && (
                        <span className="nudge-feedback">Decision ended</span>
                      )}
                      {!isReady && (
                        <>
                          <button
                            className="action-btn nudge"
                            onClick={() => handleNudgePlayer(player.id)}
                            title="Nudge player"
                          >
                            Nudge
                          </button>
                          <button
                            className="action-btn end"
                            onClick={() => handleForceEndDecision(player.id)}
                            title="End decision"
                            disabled={endingPlayerId === player.id}
                          >
                            {endingPlayerId === player.id ? 'Ending...' : 'End'}
                          </button>
                        </>
                      )}
                      <button
                        className="action-btn kick"
                        onClick={() => setKickPlayerId(player.id)}
                        title="Kick player"
                      >
                        Kick
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {players.length === 0 && (
              <div className="no-players">
                No players have joined yet. Share the session code with your students.
              </div>
            )}
          </div>
        </div>

        {session.status === 'sequencing' && !session.asyncMode && (
          <div className="arrivals-section">
            <h2>Current Hour Arrivals</h2>
            <div className="arrivals-display">
              {session.arrivals[session.currentHour - 1] && (
                <>
                  <div className="arrival-item type-a">
                    <span className="arrival-count">{session.arrivals[session.currentHour - 1].A}</span>
                    <span className="arrival-label">Type A</span>
                  </div>
                  <div className="arrival-item type-b">
                    <span className="arrival-count">{session.arrivals[session.currentHour - 1].B}</span>
                    <span className="arrival-label">Type B</span>
                  </div>
                  <div className="arrival-item type-c">
                    <span className="arrival-count">{session.arrivals[session.currentHour - 1].C}</span>
                    <span className="arrival-label">Type C</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Kick Confirmation Modal */}
      <Modal
        isOpen={!!kickPlayerId}
        onClose={() => setKickPlayerId(null)}
        title="Kick Player?"
        variant="danger"
      >
        <p>Are you sure you want to remove this player from the session?</p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setKickPlayerId(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleKickPlayer}>
            Kick Player
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={showEndSessionModal}
        onClose={() => setShowEndSessionModal(false)}
        title="End Session Early?"
        variant="danger"
      >
        <p>This will end the session for all players and mark it as completed.</p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setShowEndSessionModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleEndSessionEarly} loading={isEndingSession}>
            End Session
          </Button>
        </div>
      </Modal>
    </div>
  );
}
