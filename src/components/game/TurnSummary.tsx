import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayerGameState, PatientType, GameParameters } from '../../types';
import { PatientChip } from './PatientChip';
import { formatCurrency } from '../../utils/gameUtils';
import './TurnSummary.css';

export interface RevealEvent {
  category: 'risk' | 'completed';
  type: PatientType;
  outcome?: 'cardiac_arrest' | 'lwbs';
  id: string;
}

interface TurnSummaryProps {
  gameState: PlayerGameState;
  params: GameParameters;
  onItemRevealed?: (item: RevealEvent) => void;
  onComplete?: () => void;
}

export function TurnSummary({
  gameState,
  params,
  onItemRevealed,
  onComplete
}: TurnSummaryProps) {
  const { turnEvents } = gameState;
  const { currencySymbol } = params;

  // Stable key for turn resets - only reset when starting a new turn (new arrivals hour)
  // Do NOT include currentPhase, as that changes multiple times within a turn.
  const turnKey = `${gameState.lastArrivalsHour}`;

  // Split progress into two distinct stages.
  const [stage, setStage] = useState<'arrivals' | 'results'>('arrivals');
  const [prog1, setProg1] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);

  const didCompleteRef = useRef(false);
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arrivalEvents = useMemo(() => {
    if (!turnEvents) return [];
    const items: { category: 'arrived' | 'turnedAway'; type: PatientType; id: string }[] = [];
    (['A', 'B', 'C'] as PatientType[]).forEach((type) => {
      for (let i = 0; i < (turnEvents.arrived[type] || 0); i += 1) {
        items.push({ category: 'arrived', type, id: `arr-${type}-${i}` });
      }
    });
    (['A', 'B', 'C'] as PatientType[]).forEach((type) => {
      for (let i = 0; i < (turnEvents.turnedAway[type] || 0); i += 1) {
        items.push({ category: 'turnedAway', type, id: `ta-${type}-${i}` });
      }
    });
    return items;
  }, [turnEvents]);

  const resultEvents = useMemo(() => {
    if (!turnEvents) return [];
    const items: RevealEvent[] = [];
    turnEvents.riskEvents.forEach((event) => {
      items.push({ ...event, category: 'risk', id: `risk-${event.patientId}` });
    });
    turnEvents.completed.forEach((event) => {
      items.push({ ...event, category: 'completed', id: `comp-${event.patientId}` });
    });
    return items;
  }, [turnEvents]);

  const resultEventsRef = useRef(resultEvents);
  resultEventsRef.current = resultEvents;

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const notifyComplete = useCallback(() => {
    if (didCompleteRef.current) return;
    didCompleteRef.current = true;
    if (onCompleteRef.current) {
      onCompleteRef.current();
    }
  }, []);

  // Reset when moving to a new turn.
  useEffect(() => {
    setStage('arrivals');
    setProg1(0);
    setRevealedCount(0);
    setActiveBubbleId(null);
    didCompleteRef.current = false;

    if (bubbleTimeoutRef.current) {
      clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = null;
    }
  }, [turnKey]);

  useEffect(() => {
    return () => {
      if (bubbleTimeoutRef.current) {
        clearTimeout(bubbleTimeoutRef.current);
      }
    };
  }, []);

  // Stage 1: fast reveal of arrivals.
  useEffect(() => {
    if (stage !== 'arrivals') return;

    if (prog1 < arrivalEvents.length) {
      const timer = setTimeout(() => setProg1((prev) => prev + 1), 100);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => setStage('results'), 500);
    return () => clearTimeout(timer);
  }, [stage, prog1, arrivalEvents.length]);

  // Stage 2: reveal results one by one.
  useEffect(() => {
    if (gameState.currentPhase !== 'review') return;
    if (stage !== 'results') return;
    if (revealedCount >= resultEvents.length) return;

    const timer = setTimeout(() => {
      const latestEvents = resultEventsRef.current;
      const itemToReveal = latestEvents[revealedCount];
      if (!itemToReveal) return;

      const isLastItem = revealedCount + 1 >= latestEvents.length;

      setRevealedCount((prev) => prev + 1);
      setActiveBubbleId(itemToReveal.id);

      if (onItemRevealed) {
        onItemRevealed(itemToReveal);
      }

      if (bubbleTimeoutRef.current) {
        clearTimeout(bubbleTimeoutRef.current);
      }
      bubbleTimeoutRef.current = setTimeout(() => {
        setActiveBubbleId(null);
        bubbleTimeoutRef.current = null;
        if (isLastItem) {
          notifyComplete();
        }
      }, 1000);
    }, 1500);

    return () => clearTimeout(timer);
  }, [gameState.currentPhase, stage, revealedCount, resultEvents.length, onItemRevealed, notifyComplete]);

  // Handle case with no results.
  useEffect(() => {
    if (gameState.currentPhase !== 'review') return;
    if (stage !== 'results') return;
    if (resultEvents.length !== 0) return;

    const timer = setTimeout(() => {
      notifyComplete();
    }, 500);

    return () => clearTimeout(timer);
  }, [gameState.currentPhase, stage, resultEvents.length, notifyComplete]);

  const arrivalsSection = useMemo(() => {
    const arrivals = arrivalEvents.filter((event) => event.category === 'arrived');
    const turnedAway = arrivalEvents.filter((event) => event.category === 'turnedAway');

    return (
      <div className="section-group static-group">
        <div className="row">
          <div className="sub-section">
            <h4>New Arrivals</h4>
            <div className="chips-row">
              {arrivals.map((event, index) => index < prog1 && (
                <motion.div
                  key={event.id}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="compact-chip"
                >
                  <PatientChip patient={{ type: event.type, status: 'waiting', waitingTime: 0 } as any} />
                </motion.div>
              ))}
              {prog1 >= arrivals.length && arrivals.length === 0 && <span className="none">None</span>}
            </div>
          </div>
          <div className="sub-section">
            <h4>Turned Away</h4>
            <div className="chips-row">
              {turnedAway.map((event) => arrivalEvents.indexOf(event) < prog1 && (
                <motion.div
                  key={event.id}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="compact-chip"
                >
                  <PatientChip patient={{ type: event.type, status: 'turned_away', waitingTime: 0 } as any} />
                </motion.div>
              ))}
              {prog1 >= arrivalEvents.length && turnedAway.length === 0 && <span className="none">None</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }, [arrivalEvents, prog1]);

  if (!turnEvents) return null;

  return (
    <div className="turn-summary-card">
      <h3>Turn Summary</h3>

      {arrivalsSection}

      <div className="section-group dynamic-group">
        <div className="results-container">
          <div className="sub-section full-width">
            <h4>Risk Events</h4>
            <div className="chips-row">
              {resultEvents.filter((event) => event.category === 'risk').map((event) => {
                const idx = resultEvents.indexOf(event);
                if (idx >= revealedCount) return null;
                const active = activeBubbleId === event.id;
                return (
                  <motion.div
                    key={event.id}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={`compact-chip risk ${active ? 'active' : ''}`}
                  >
                    <PatientChip
                      patient={{
                        type: event.type,
                        status: event.outcome === 'cardiac_arrest' ? 'cardiac_arrest' : 'lwbs',
                        waitingTime: 0
                      } as any}
                    />
                    <span className="tiny-badge">{event.outcome === 'cardiac_arrest' ? 'Code' : 'LWBS'}</span>
                    <AnimatePresence>
                      {active && (
                        <motion.div
                          initial={{ y: 0, opacity: 0 }}
                          animate={{ y: -15, opacity: 1 }}
                          exit={{ y: -30, opacity: 0 }}
                          className="val-bubble cost"
                        >
                          -{formatCurrency(params.riskEventCost[event.type], currencySymbol)}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
              {stage === 'results' &&
                revealedCount >= resultEvents.length &&
                resultEvents.filter((event) => event.category === 'risk').length === 0 && (
                  <span className="none">None</span>
              )}
            </div>
          </div>

          <div className="sub-section full-width">
            <h4>Completed</h4>
            <div className="chips-row">
              {resultEvents.filter((event) => event.category === 'completed').map((event) => {
                const idx = resultEvents.indexOf(event);
                if (idx >= revealedCount) return null;
                const active = activeBubbleId === event.id;
                return (
                  <motion.div
                    key={event.id}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={`compact-chip ${active ? 'active' : ''}`}
                  >
                    <PatientChip patient={{ type: event.type, status: 'treated', waitingTime: 0 } as any} />
                    <AnimatePresence>
                      {active && (
                        <motion.div
                          initial={{ y: 0, opacity: 0 }}
                          animate={{ y: -15, opacity: 1 }}
                          exit={{ y: -30, opacity: 0 }}
                          className="val-bubble revenue"
                        >
                          +{formatCurrency(params.revenuePerPatient[event.type], currencySymbol)}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
              {stage === 'results' &&
                revealedCount >= resultEvents.length &&
                resultEvents.filter((event) => event.category === 'completed').length === 0 && (
                  <span className="none">None</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

