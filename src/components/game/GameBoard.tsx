import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../../contexts/GameContext';
import { RoomCard, EmptyRoomSlot, RoomInventoryCard } from './RoomCard';
import { PatientChip } from './PatientChip';
import { WaitingQueue } from './WaitingQueue';
import { TurnSummary } from './TurnSummary';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { Room, RoomType, PatientType } from '../../types';
import { HOURS_OF_DAY, PATIENT_ROOM_OPTIONS, DEFAULT_PARAMETERS } from '../../data/gameConstants';
import { formatCurrency, canTreatInRoom, getTreatmentTime } from '../../utils/gameUtils';
import './GameBoard.css';

export function GameBoard() {
  const {
    session,
    gameState,
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
    completeTurn
  } = useGame();

  const [selectedRoom, setSelectedRoom] = useState<RoomType | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [diceResults, setDiceResults] = useState<Map<string, { roll: number; isEvent: boolean }>>(new Map());
  const [isRolling, setIsRolling] = useState(false);
  const [phaseBanner, setPhaseBanner] = useState('');
  const [showNudge, setShowNudge] = useState(false);

  // Refs for cleanup and stable function references
  const rollAnimationRef = useRef<NodeJS.Timeout | null>(null);
  const treatmentTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rollingFailsafeRef = useRef<NodeJS.Timeout | null>(null);
  // Refs to hold the latest functions to avoid stale closures in timeouts
  const processTreatmentRef = useRef(processTreatment);
  processTreatmentRef.current = processTreatment;
  const applyRiskEventResultsRef = useRef(applyRiskEventResults);
  applyRiskEventResultsRef.current = applyRiskEventResults;
  // Store dice results for applying after animation
  const pendingRiskResultsRef = useRef<{ patientId: string; roll: number; isEvent: boolean; type: PatientType }[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rollAnimationRef.current) clearTimeout(rollAnimationRef.current);
      if (treatmentTimeoutRef.current) clearTimeout(treatmentTimeoutRef.current);
      if (rollingFailsafeRef.current) clearTimeout(rollingFailsafeRef.current);
    };
  }, []);

  const isStaffingPhase = session?.status === 'staffing';
  const isSequencingPhase = session?.status === 'sequencing';
  const currentHour = session?.currentHour || 0;
  const params = session?.parameters || DEFAULT_PARAMETERS;

  // Update phase banner
  useEffect(() => {
    if (!gameState) return;

    switch (gameState.currentPhase) {
      case 'arriving':
        setPhaseBanner('New Patients Arriving');
        break;
      case 'sequencing':
        setPhaseBanner('Assign Patients to Rooms');
        break;
      case 'rolling':
        setPhaseBanner('Rolling for Risk Events');
        break;
      case 'treating':
        setPhaseBanner('Patients Receiving Treatment');
        break;
      case 'waiting':
        setPhaseBanner('Waiting for Other Players');
        break;
    }
  }, [gameState?.currentPhase]);

  // Clear selected patient when leaving sequencing phase
  // This prevents the UI from showing rooms as available when they aren't
  useEffect(() => {
    if (gameState?.currentPhase !== 'sequencing') {
      setSelectedPatient(null);
    }
  }, [gameState?.currentPhase]);

  // Failsafe: if we get stuck in rolling, force treatment
  useEffect(() => {
    if (!isSequencingPhase || !gameState) return;
    if (gameState.currentPhase !== 'rolling') {
      if (rollingFailsafeRef.current) {
        clearTimeout(rollingFailsafeRef.current);
        rollingFailsafeRef.current = null;
      }
      return;
    }

    if (rollingFailsafeRef.current) return;
    rollingFailsafeRef.current = setTimeout(async () => {
      rollingFailsafeRef.current = null;
      setIsRolling(false);
      setDiceResults(new Map());
      try {
        // Use ref to get the latest processTreatment function (avoids stale closure)
        await processTreatmentRef.current();
      } catch (error) {
        console.error('Rolling failsafe treatment error:', error);
      }
    }, 8000);
  }, [isSequencingPhase, gameState?.currentPhase]);

  // Clear dice results when starting a new hour
  useEffect(() => {
    if (gameState?.currentPhase === 'arriving' || gameState?.currentPhase === 'sequencing') {
      setDiceResults(new Map());
      setIsRolling(false);
    }
  }, [currentHour, gameState?.currentPhase]);

  // Process arrivals when hour changes - uses persisted lastArrivalsHour from gameState
  // The processArrivals function itself guards against duplicate processing
  useEffect(() => {
    if (!isSequencingPhase || currentHour <= 0 || !session?.arrivals || !gameState) return;

    // Use persisted lastArrivalsHour from gameState to prevent re-processing on remount
    // Handle undefined for backwards compatibility
    const lastArrivalsHour = gameState.lastArrivalsHour ?? 0;
    if (lastArrivalsHour >= currentHour) return;

    // Don't process arrivals if we're in the middle of rolling or treating
    // (These phases shouldn't occur when lastArrivalsHour < currentHour, but guard anyway)
    if (gameState.currentPhase === 'rolling' || gameState.currentPhase === 'treating') return;

    const arrivals = session.arrivals[currentHour - 1];
    if (arrivals) {
      processArrivals(arrivals);
    }
  }, [
    currentHour,
    isSequencingPhase,
    session?.arrivals,
    gameState?.currentPhase,
    gameState?.lastArrivalsHour,
    processArrivals
  ]);

  // Auto-process treatment when in treating phase (fallback for edge cases)
  // Note: Primary treatment processing happens in handleConfirmSequencing
  // Uses persisted lastTreatmentHour from gameState to prevent duplicate processing
  useEffect(() => {
    if (!isSequencingPhase || currentHour <= 0 || !gameState) return;
    if (gameState.currentPhase !== 'treating') return;
    if (isRolling) return;

    // Use persisted lastTreatmentHour from gameState
    const lastTreatmentHour = gameState.lastTreatmentHour ?? 0;
    if (lastTreatmentHour >= currentHour) return;

    // This is a fallback - treatment should have been processed by handleConfirmSequencing
    const timeout = setTimeout(async () => {
      // Re-check conditions before processing
      if (gameState.currentPhase === 'treating') {
        const currentLastTreatment = gameState.lastTreatmentHour ?? 0;
        if (currentLastTreatment < currentHour) {
          try {
            // Use ref to get the latest processTreatment function (avoids stale closure)
            await processTreatmentRef.current();
          } catch (error) {
            console.error('Error in fallback treatment processing:', error);
          }
        }
      }
    }, 3000);

    return () => clearTimeout(timeout);
  }, [
    isSequencingPhase,
    currentHour,
    gameState?.currentPhase,
    gameState?.lastTreatmentHour,
    isRolling
  ]);

  const handleAddRoom = useCallback((type: RoomType) => {
    if (!gameState) return;

    const occupiedPositions = new Set(gameState.rooms.map(r => r.position));
    for (let i = 0; i < 16; i++) {
      if (!occupiedPositions.has(i)) {
        addRoom(type, i);
        break;
      }
    }
    setSelectedRoom(null);
  }, [gameState, addRoom]);

  const handleDropOnSlot = useCallback((position: number) => {
    if (selectedRoom) {
      addRoom(selectedRoom, position);
      setSelectedRoom(null);
    }
  }, [selectedRoom, addRoom]);

  const handlePatientSelect = useCallback((patientId: string) => {
    setSelectedPatient(prev => prev === patientId ? null : patientId);
  }, []);

  const handleRoomClick = useCallback((roomId: string) => {
    if (!selectedPatient || !gameState) return;
    if (gameState.currentPhase !== 'sequencing') return;

    const patient = gameState.waitingRoom.find(p => p.id === selectedPatient);
    const room = gameState.rooms.find(r => r.id === roomId);

    if (patient && room && !room.isOccupied && canTreatInRoom(patient.type, room.type)) {
      movePatientToRoom(selectedPatient, roomId);
      setSelectedPatient(null);
    }
  }, [selectedPatient, gameState, movePatientToRoom]);

  const handleStaffingComplete = useCallback(async () => {
    await completeStaffing();
  }, [completeStaffing]);

  const handleConfirmSequencing = useCallback(async () => {
    setShowConfirmModal(false);
    await completeSequencing();

    // Roll dice for risk events (doesn't remove patients yet)
    setIsRolling(true);
    let results: { patientId: string; roll: number; isEvent: boolean; type: PatientType }[] = [];
    try {
      results = await processRiskEvents();
      // Store results for applying after animation
      pendingRiskResultsRef.current = results;
      console.log('[GameBoard] Stored risk results:', results);
      console.log('[GameBoard] Type A risk events:', results.filter(r => r.type === 'A' && r.isEvent));
    } catch (error) {
      console.error('Error rolling for risk events:', error);
      setIsRolling(false);
      try {
        await applyRiskEventResultsRef.current([]);
        await processTreatmentRef.current();
      } catch (treatmentError) {
        console.error('Error processing treatment after risk error:', treatmentError);
      }
      return;
    }

    if (results.length === 0) {
      setIsRolling(false);
      setDiceResults(new Map());
      treatmentTimeoutRef.current = setTimeout(async () => {
        treatmentTimeoutRef.current = null;
        try {
          // Apply risk results (none) and process treatment
          await applyRiskEventResultsRef.current([]);
          await processTreatmentRef.current();
        } catch (error) {
          console.error('Error processing treatment with no patients:', error);
        }
      }, 500);
      return;
    }

    // Animate dice rolls with slowing effect
    const rollDuration = 3000;
    let elapsed = 0;
    let currentInterval = 50; // Start fast

    // Clear any existing animation/timeout
    if (rollAnimationRef.current) clearTimeout(rollAnimationRef.current);
    if (treatmentTimeoutRef.current) clearTimeout(treatmentTimeoutRef.current);

    const animateRoll = () => {
      elapsed += currentInterval;

      // Gradually slow down the rolling speed
      // Start at 50ms, end at ~400ms intervals
      const progress = elapsed / rollDuration;
      currentInterval = 50 + Math.pow(progress, 2) * 350;

      const newResults = new Map<string, { roll: number; isEvent: boolean }>();

      results.forEach(result => {
        const randomRoll = Math.floor(Math.random() * 20) + 1;
        newResults.set(result.patientId, {
          roll: elapsed >= rollDuration ? result.roll : randomRoll,
          isEvent: elapsed >= rollDuration ? result.isEvent : false
        });
      });

      setDiceResults(newResults);

      if (elapsed >= rollDuration) {
        rollAnimationRef.current = null;
        setIsRolling(false);

        // After dice animation, wait for risk event display then apply results and process treatment
        treatmentTimeoutRef.current = setTimeout(async () => {
          treatmentTimeoutRef.current = null;
          try {
            // Apply risk event results (removes patients, updates stats)
            // Keep dice results visible during exit animation
            console.log('[GameBoard] Calling applyRiskEventResults with:', pendingRiskResultsRef.current);
            console.log('[GameBoard] Risk events to apply:', pendingRiskResultsRef.current.filter(r => r.isEvent));
            await applyRiskEventResultsRef.current(pendingRiskResultsRef.current);

            // Wait for exit animation to complete (1.5s for risk events) before clearing dice
            setTimeout(() => {
              setDiceResults(new Map());
            }, 1800);

            // Process treatment while animation plays
            await processTreatmentRef.current();
          } catch (error) {
            console.error('Error processing risk events and treatment:', error);
          }
        }, 2500);
      } else {
        rollAnimationRef.current = setTimeout(animateRoll, currentInterval);
      }
    };

    rollAnimationRef.current = setTimeout(animateRoll, currentInterval);
  }, [completeSequencing, processRiskEvents, processTreatment]);

  const handleSequencingComplete = useCallback(() => {
    if (!gameState) return;
    // Only allow sequencing completion during the sequencing phase
    if (gameState.currentPhase !== 'sequencing') return;

    const emptyRooms = gameState.rooms.filter(r => !r.isOccupied);
    const hasAssignablePatient = gameState.waitingRoom.some(patient =>
      emptyRooms.some(room => canTreatInRoom(patient.type, room.type))
    );

    if (hasAssignablePatient) {
      setShowConfirmModal(true);
    } else {
      handleConfirmSequencing();
    }
  }, [gameState, handleConfirmSequencing]);


  const totalCost = gameState?.totalCost || 0;
  const totalRevenue = gameState?.totalRevenue || 0;
  const staffingCost = gameState?.staffingCost || 0;
  const profit = totalRevenue - totalCost;

  // Get highlighted slots for selected patient
  // Only highlight rooms during sequencing phase when player can actually assign patients
  const getHighlightedSlots = useCallback((room: Room) => {
    if (!selectedPatient || !gameState) return undefined;
    // Only highlight rooms during sequencing phase
    if (gameState.currentPhase !== 'sequencing') return undefined;

    const patient = gameState.waitingRoom.find(p => p.id === selectedPatient);
    if (!patient || room.isOccupied) return undefined;

    if (canTreatInRoom(patient.type, room.type)) {
      return getTreatmentTime(patient.type, params);
    }
    return undefined;
  }, [selectedPatient, gameState, params]);

  if (!gameState) {
    return <div className="game-board-loading">Loading game...</div>;
  }

  return (
    <div className="game-board">
      {/* Nudge popup */}
      <AnimatePresence>
        {showNudge && (
          <motion.div
            className="nudge-popup"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={() => setShowNudge(false)}
          >
            <span>Please make your decision!</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase Banner */}
      {isSequencingPhase && (
        <div className="phase-banner">
          <div className="hour-display">
            Hour {currentHour}: {HOURS_OF_DAY[currentHour - 1] || ''}
          </div>
          <div className="phase-display">{phaseBanner}</div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-item revenue">
          <span className="stat-label">Revenue</span>
          <span className="stat-value">{formatCurrency(totalRevenue)}</span>
        </div>
        <div className="stat-item cost">
          <span className="stat-label">Cost</span>
          <span className="stat-value">{formatCurrency(totalCost)}</span>
        </div>
        <div className={`stat-item profit ${profit >= 0 ? 'positive' : 'negative'}`}>
          <span className="stat-label">Profit</span>
          <span className="stat-value">{formatCurrency(profit)}</span>
        </div>
      </div>

      {/* Main Board Area */}
      <div className="board-layout">
        {/* Waiting Area */}
        <div className="waiting-area">
          <div className="entry-door">
            <span>Entry</span>
          </div>

          <WaitingQueue
            patients={gameState.waitingRoom}
            maxSize={params.maxWaitingRoom}
            selectedPatientId={selectedPatient}
            onPatientClick={handlePatientSelect}
            showDice={diceResults.size > 0 || isRolling}
            diceResults={diceResults}
            isRolling={isRolling}
          />

          <div className="exit-door">
            <span>Exit</span>
          </div>
        </div>

        {/* Room Grid */}
        <div className="room-grid">
          {Array.from({ length: 16 }, (_, i) => {
            const room = gameState.rooms.find(r => r.position === i);

            if (room) {
              const canMovePatient = isSequencingPhase
                && gameState.currentPhase === 'sequencing'
                && room.patient
                && room.patient.treatmentProgress === getTreatmentTime(room.patient.type, params);

              return (
                <div key={i} className="room-grid-cell">
                  <RoomCard
                    room={room}
                    isHighlighted={!!getHighlightedSlots(room)}
                    highlightedSlot={getHighlightedSlots(room)}
                    isGreyedOut={isSequencingPhase && room.isOccupied && gameState.currentPhase === 'sequencing'}
                    isPatientMovable={!!canMovePatient}
                    onPatientDrop={() => handleRoomClick(room.id)}
                    onPatientRemove={canMovePatient ? movePatientBackToQueue : undefined}
                  />
                  {isStaffingPhase && (
                    <button
                      className="remove-room-btn"
                      onClick={() => removeRoom(room.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            }

            return (
              <EmptyRoomSlot
                key={i}
                position={i}
                isHighlighted={isStaffingPhase && selectedRoom !== null}
                onDrop={() => handleDropOnSlot(i)}
              />
            );
          })}
        </div>

        {/* Room Inventory (Staffing Phase) */}
        {isStaffingPhase && (
          <div className="room-inventory">
            <h3>Available Rooms</h3>
            <div className="inventory-grid">
              <RoomInventoryCard
                type="high"
                cost={params.roomCosts.high}
                onClick={() => setSelectedRoom('high')}
                disabled={staffingCost + params.roomCosts.high > params.maxStaffingBudget}
              />
              <RoomInventoryCard
                type="medium"
                cost={params.roomCosts.medium}
                onClick={() => setSelectedRoom('medium')}
                disabled={staffingCost + params.roomCosts.medium > params.maxStaffingBudget}
              />
              <RoomInventoryCard
                type="low"
                cost={params.roomCosts.low}
                onClick={() => setSelectedRoom('low')}
                disabled={staffingCost + params.roomCosts.low > params.maxStaffingBudget}
              />
            </div>

            <div className="demand-info">
              <h4>Average Daily Demand</h4>
              <div className="demand-row">
                <span className="demand-type type-a">Type A</span>
                <span>{params.dailyArrivals.A}</span>
              </div>
              <div className="demand-row">
                <span className="demand-type type-b">Type B</span>
                <span>{params.dailyArrivals.B}</span>
              </div>
              <div className="demand-row">
                <span className="demand-type type-c">Type C</span>
                <span>{params.dailyArrivals.C}</span>
              </div>
            </div>

            <div className="staffing-footer">
              <div className="budget-info">
                <div className="budget-line">
                  <span>Budget Used:</span>
                  <strong>{formatCurrency(staffingCost)}</strong>
                </div>
                <div className="budget-line">
                  <span>Remaining:</span>
                  <strong>{formatCurrency(params.maxStaffingBudget - staffingCost)}</strong>
                </div>
              </div>
              <Button
                variant="primary"
                onClick={handleStaffingComplete}
                disabled={gameState.rooms.length === 0}
              >
                Finish Staffing
              </Button>
            </div>
          </div>
        )}

        {/* Sequencing Controls */}
        {(() => {
          const emptyRooms = gameState.rooms.filter(r => !r.isOccupied);
          const hasAssignablePatient = gameState.waitingRoom.some(patient =>
            emptyRooms.some(room => canTreatInRoom(patient.type, room.type))
          );
          const allRoomsFull = emptyRooms.length === 0 && gameState.rooms.length > 0;
          const noCompatibleRooms = !hasAssignablePatient && gameState.waitingRoom.length > 0 && emptyRooms.length > 0;

          return (
            <div className="sequencing-controls">
              <TurnSummary gameState={gameState} />

              {allRoomsFull && gameState.waitingRoom.length > 0 && gameState.currentPhase === 'sequencing' && (
                <div className="sequencing-warning">
                  All rooms are occupied. No further patient allocation possible this hour.
                </div>
              )}
              {noCompatibleRooms && gameState.currentPhase === 'sequencing' && (
                <div className="sequencing-warning">
                  No compatible rooms available for waiting patients.
                </div>
              )}

              {gameState.currentPhase === 'sequencing' && (
                <Button
                  variant="success"
                  size="large"
                  onClick={handleSequencingComplete}
                >
                  Sequencing Complete
                </Button>
              )}

              {gameState.currentPhase === 'review' && (
                <Button
                  variant="primary"
                  size="large"
                  onClick={() => completeTurn()}
                >
                  Finish Turn
                </Button>
              )}
            </div>
          );
        })()}

        {/* Waiting For Players Message */}
        {gameState.currentPhase === 'waiting' && (
          <div className="waiting-message-container">
            <div className="waiting-message">
              <h3>Waiting for other players...</h3>
              <p>The next hour will begin once all players have finished their turn.</p>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="Unassigned Patients"
      >
        <div className="modal-content">
          <p>You have empty rooms and patients waiting. Are you sure you want to proceed?</p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleConfirmSequencing}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
