import React, { useState, useEffect, useMemo, useRef } from 'react';
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
    onItemRevealed?: (item: any) => void;
    onComplete?: () => void;
}

export function TurnSummary({ gameState, params, onItemRevealed, onComplete }: TurnSummaryProps) {
    const { turnEvents } = gameState;
    const { currencySymbol } = params;

    // Stable key for turn resets - only reset when starting a new turn (new arrivals hour)
    // Do NOT include currentPhase, as that changes multiple times within a turn
    const turnKey = `${gameState.lastArrivalsHour}`;

    // Split progress into two distinct stages
    const [stage, setStage] = useState<'arrivals' | 'results'>('arrivals');
    const [prog1, setProg1] = useState(0); // Progress for arrivals phase
    const [revealedCount, setRevealedCount] = useState(0); // How many result items have been revealed
    const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);

    // Reset when moving to a new turn
    useEffect(() => {
        setStage('arrivals');
        setProg1(0);
        setRevealedCount(0);
        setActiveBubbleId(null);
    }, [turnKey]);

    // Pre-calculate event lists
    const arrivalEvents = useMemo(() => {
        if (!turnEvents) return [];
        const items: { category: 'arrived' | 'turnedAway'; type: PatientType; id: string }[] = [];
        (['A', 'B', 'C'] as PatientType[]).forEach(type => {
            for (let i = 0; i < (turnEvents.arrived[type] || 0); i++)
                items.push({ category: 'arrived', type, id: `arr-${type}-${i}` });
        });
        (['A', 'B', 'C'] as PatientType[]).forEach(type => {
            for (let i = 0; i < (turnEvents.turnedAway[type] || 0); i++)
                items.push({ category: 'turnedAway', type, id: `ta-${type}-${i}` });
        });
        return items;
    }, [turnEvents]);

    const resultEvents = useMemo(() => {
        if (!turnEvents) return [];
        const items: { category: 'risk' | 'completed'; type: PatientType; outcome?: any; id: string }[] = [];
        turnEvents.riskEvents.forEach((e, idx) => items.push({ ...e, category: 'risk', id: `risk-${e.patientId}` }));
        turnEvents.completed.forEach((e, idx) => items.push({ ...e, category: 'completed', id: `comp-${e.patientId}` }));
        return items;
    }, [turnEvents]);

    // Stage 1: Fast reveal of arrivals
    useEffect(() => {
        if (stage === 'arrivals') {
            if (prog1 < arrivalEvents.length) {
                const timer = setTimeout(() => setProg1(p => p + 1), 100);
                return () => clearTimeout(timer);
            } else {
                // Done with arrivals, move to results after a small pause
                const timer = setTimeout(() => setStage('results'), 500);
                return () => clearTimeout(timer);
            }
        }
    }, [stage, prog1, arrivalEvents.length]);

    // Stage 2: Reveal results one by one
    // Use a ref to access current resultEvents in the timer callback without causing re-renders
    const resultEventsRef = useRef(resultEvents);
    resultEventsRef.current = resultEvents;

    useEffect(() => {
        if (stage !== 'results') return;
        if (revealedCount >= resultEvents.length) return;

        const timer = setTimeout(() => {
            // Use ref to get latest events
            const latestEvents = resultEventsRef.current;
            const itemToReveal = latestEvents[revealedCount];
            if (!itemToReveal) return;

            setRevealedCount(prev => prev + 1);
            setActiveBubbleId(itemToReveal.id);
            setTimeout(() => setActiveBubbleId(null), 1000);
            if (onItemRevealed) onItemRevealed(itemToReveal);

            // If this was the last item, notify completion
            if (revealedCount + 1 >= latestEvents.length && onComplete) {
                // Wait slightly for the last bubble to be more meaningful
                setTimeout(onComplete, 1000);
            }
        }, 1500);

        return () => clearTimeout(timer);
    }, [stage, revealedCount, resultEvents.length, onItemRevealed, onComplete]);

    // Handle case with no results
    useEffect(() => {
        if (stage === 'results' && resultEvents.length === 0 && onComplete) {
            // Wait a tiny bit more to ensure no race conditions on data sync
            const timer = setTimeout(onComplete, 500);
            return () => clearTimeout(timer);
        }
    }, [stage, resultEvents.length, onComplete]);

    // MEMOIZED JSX CHUNKS: These won't redraw even if prog2 or activeBubbleId changes
    // because their dependency (prog1) remains static once arrivals stage is done.
    const arrivalsSection = useMemo(() => {
        const arr = arrivalEvents.filter(e => e.category === 'arrived');
        const ta = arrivalEvents.filter(e => e.category === 'turnedAway');

        return (
            <div className="section-group static-group">
                <div className="row">
                    <div className="sub-section">
                        <h4>New Arrivals</h4>
                        <div className="chips-row">
                            {arr.map((e, i) => i < prog1 && (
                                <motion.div key={e.id} initial={{ scale: 0 }} animate={{ scale: 1 }} className="compact-chip">
                                    <PatientChip patient={{ type: e.type, status: 'waiting', waitingTime: 0 } as any} />
                                </motion.div>
                            ))}
                            {prog1 >= arr.length && arr.length === 0 && <span className="none">None</span>}
                        </div>
                    </div>
                    <div className="sub-section">
                        <h4>Turned Away</h4>
                        <div className="chips-row">
                            {ta.map((e, i) => arrivalEvents.indexOf(e) < prog1 && (
                                <motion.div key={e.id} initial={{ scale: 0 }} animate={{ scale: 1 }} className="compact-chip">
                                    <PatientChip patient={{ type: e.type, status: 'turned_away', waitingTime: 0 } as any} />
                                </motion.div>
                            ))}
                            {prog1 >= arrivalEvents.length && ta.length === 0 && <span className="none">None</span>}
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

            {/* The static part */}
            {arrivalsSection}

            {/* The dynamic part */}
            <div className="section-group dynamic-group">
                <div className="results-container">
                    <div className="sub-section full-width">
                        <h4>Risk Events</h4>
                        <div className="chips-row">
                            {resultEvents.filter(e => e.category === 'risk').map((e) => {
                                const idx = resultEvents.indexOf(e);
                                if (idx >= revealedCount) return null;
                                const active = activeBubbleId === e.id;
                                return (
                                    <motion.div key={e.id} initial={{ scale: 0 }} animate={{ scale: 1 }} className={`compact-chip risk ${active ? 'active' : ''}`}>
                                        <PatientChip patient={{ type: e.type, status: e.outcome === 'cardiac_arrest' ? 'cardiac_arrest' : 'lwbs', waitingTime: 0 } as any} />
                                        <span className="tiny-badge">{e.outcome === 'cardiac_arrest' ? 'Code' : 'LWBS'}</span>
                                        <AnimatePresence>
                                            {active && (
                                                <motion.div initial={{ y: 0, opacity: 0 }} animate={{ y: -15, opacity: 1 }} exit={{ y: -30, opacity: 0 }} className="val-bubble cost">
                                                    -{formatCurrency(params.riskEventCost[e.type], currencySymbol)}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </motion.div>
                                );
                            })}
                            {stage === 'results' && revealedCount >= resultEvents.length && resultEvents.filter(e => e.category === 'risk').length === 0 && <span className="none">None</span>}
                        </div>
                    </div>

                    <div className="sub-section full-width">
                        <h4>Completed</h4>
                        <div className="chips-row">
                            {resultEvents.filter(e => e.category === 'completed').map((e) => {
                                const idx = resultEvents.indexOf(e);
                                if (idx >= revealedCount) return null;
                                const active = activeBubbleId === e.id;
                                return (
                                    <motion.div key={e.id} initial={{ scale: 0 }} animate={{ scale: 1 }} className={`compact-chip ${active ? 'active' : ''}`}>
                                        <PatientChip patient={{ type: e.type, status: 'treated', waitingTime: 0 } as any} />
                                        <AnimatePresence>
                                            {active && (
                                                <motion.div initial={{ y: 0, opacity: 0 }} animate={{ y: -15, opacity: 1 }} exit={{ y: -30, opacity: 0 }} className="val-bubble revenue">
                                                    +{formatCurrency(params.revenuePerPatient[e.type], currencySymbol)}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </motion.div>
                                );
                            })}
                            {stage === 'results' && revealedCount >= resultEvents.length && resultEvents.filter(e => e.category === 'completed').length === 0 && <span className="none">None</span>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
