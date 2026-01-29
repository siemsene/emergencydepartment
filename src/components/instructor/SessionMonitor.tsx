import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Session, Player } from '../../types';
import {
  getSession,
  subscribeToSession,
  subscribeToSessionPlayers,
  advanceSessionToSequencing,
  advanceSessionHour,
  endSessionEarly,
  kickPlayer,
  updatePlayerGameState,
  updatePlayerGameStateFields
} from '../../services/firebaseService';
import { formatCurrency, calculateProfit } from '../../utils/gameUtils';
import { HOURS_OF_DAY } from '../../data/gameConstants';
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

  const allPlayersReady = useCallback(() => {
    if (players.length === 0) return false;

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
  }, [players, session?.status, session?.currentHour]);

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

  const handleNudgePlayer = (playerId: string) => {
    // In a real implementation, this would send a real-time notification
    // For now, we'll just show a local indicator
    setNudgePlayerId(playerId);
    setTimeout(() => setNudgePlayerId(null), 3000);
  };

  const handleForceEndDecision = async (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player || !session) return;

    // Force end the decision by setting all required completion fields
    await updatePlayerGameStateFields(playerId, {
      currentPhase: 'waiting',
      hourComplete: true,
      lastCompletedHour: session.currentHour,
      lastTreatmentHour: session.currentHour
    });
  };

  useEffect(() => {
    if (!session || !sessionId) return;
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

        // IMPORTANT: Don't rescue 'waiting' phase if arrivals haven't been processed yet.
        // This prevents incorrectly marking the player as complete for a new hour
        // when they're still in 'waiting' from the previous hour.
        const arrivalsProcessedForCurrentHour = lastArrivalsHour >= session.currentHour;
        const sequencingSubmittedForCurrentHour = lastSequencingHour >= session.currentHour;

        // Player is in 'waiting' phase but hourComplete is false - set it to true
        // Only do this if arrivals have been processed (meaning they actually went through this hour)
        if (
          player.gameState.currentPhase === 'waiting' &&
          !player.gameState.hourComplete &&
          arrivalsProcessedForCurrentHour &&
          sequencingSubmittedForCurrentHour &&
          lastTreatmentHour < session.currentHour
        ) {
          await updatePlayerGameStateFields(player.id, {
            hourComplete: true,
            lastCompletedHour: session.currentHour,
            lastTreatmentHour: session.currentHour
          });
          continue;
        }

        // Player is in 'waiting' phase with hourComplete true but lastCompletedHour is behind
        // Only rescue if arrivals have been processed for this hour
        if (
          player.gameState.currentPhase === 'waiting' &&
          player.gameState.hourComplete &&
          lastCompletedHour < session.currentHour &&
          arrivalsProcessedForCurrentHour &&
          sequencingSubmittedForCurrentHour &&
          lastTreatmentHour < session.currentHour
        ) {
          await updatePlayerGameStateFields(player.id, {
            lastCompletedHour: session.currentHour,
            lastTreatmentHour: session.currentHour
          });
          continue;
        }

        // Player is stuck in 'treating' phase with no active treatments
        // Only rescue if treatment hasn't been processed for this hour yet
        if (player.gameState.currentPhase === 'treating' && lastTreatmentHour < session.currentHour) {
          const hasActiveTreatment = player.gameState.rooms.some(
            room => room.isOccupied && room.patient && (room.patient.treatmentProgress || 0) > 0
          );

          // Only rescue if there's genuinely no active treatment
          // This means either no patients in rooms, or all patients have completed (treatmentProgress <= 0)
          if (!hasActiveTreatment) {
            await updatePlayerGameStateFields(player.id, {
              currentPhase: 'waiting',
              hourComplete: true,
              lastCompletedHour: session.currentHour,
              lastTreatmentHour: session.currentHour
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
            {session.status === 'staffing' ? 'Staffing Phase' :
             session.status === 'sequencing' ? `Hour ${session.currentHour}: ${HOURS_OF_DAY[session.currentHour - 1] || ''}` :
             session.status === 'completed' ? 'Completed' : 'Setup'}
          </div>
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
                         session.status === 'sequencing' ? (session.currentHour / 24) * 100 :
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
                // Check if player is truly ready for the CURRENT hour
                const lastArrivals = player.gameState.lastArrivalsHour ?? 0;
                const lastCompleted = player.gameState.lastCompletedHour ?? 0;
                const isReady = session.status === 'staffing'
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
                      {formatCurrency(profit)}
                    </span>
                    <span className="queue-count">
                      {player.gameState.waitingRoom.length}
                    </span>
                    <div className="player-actions">
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
                          >
                            End
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

        {session.status === 'sequencing' && (
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
