import React from 'react';
import { PlayerGameState, PatientType } from '../../types';
import { PatientChip } from './PatientChip';
import './TurnSummary.css';

interface TurnSummaryProps {
    gameState: PlayerGameState;
}

export function TurnSummary({ gameState }: TurnSummaryProps) {
    const { turnEvents } = gameState;

    if (!turnEvents) return null;

    const { arrived, turnedAway, riskEvents, completed } = turnEvents;

    // Helper to render arrival chips
    const renderArrivalChips = () => {
        const chips: React.ReactNode[] = [];
        (['A', 'B', 'C'] as PatientType[]).forEach(type => {
            const count = arrived[type] || 0;
            for (let i = 0; i < count; i++) {
                chips.push(
                    <div key={`arrival-${type}-${i}`} className="summary-chip-wrapper">
                        <PatientChip patient={{ type, status: 'waiting', waitingTime: 0 } as any} />
                    </div>
                );
            }
        });

        if (chips.length === 0) return <span className="empty-text">None</span>;
        return <div className="chips-container">{chips}</div>;
    };

    // Helper to render risk event chips
    const renderRiskChips = () => {
        if (riskEvents.length === 0) return <span className="empty-text">None</span>;

        return (
            <div className="chips-container">
                {riskEvents.map((event, index) => (
                    <div key={`risk-${event.patientId}-${index}`} className="summary-chip-wrapper risk">
                        <PatientChip patient={{ type: event.type, status: event.outcome === 'cardiac_arrest' ? 'cardiac_arrest' : 'lwbs', waitingTime: 0 } as any} />
                        <span className="risk-badge">{event.outcome === 'cardiac_arrest' ? 'Code Blue' : 'LWBS'}</span>
                    </div>
                ))}
            </div>
        );
    };

    // Helper to render turned away chips
    const renderTurnedAwayChips = () => {
        const elements: React.ReactNode[] = [];

        (['A', 'B', 'C'] as PatientType[]).forEach(type => {
            const count = turnedAway[type] || 0;
            for (let i = 0; i < count; i++) {
                elements.push(
                    <div key={`turned-away-${type}-${i}`} className="summary-chip-wrapper">
                        <PatientChip patient={{ type, status: 'turned_away', waitingTime: 0 } as any} />
                    </div>
                );
            }
        });

        if (elements.length === 0) return <span className="empty-text">None</span>;
        return <div className="chips-container">{elements}</div>;
    }

    // Helper to render completed chips
    const renderCompletedChips = () => {
        if (completed.length === 0) return <span className="empty-text">None</span>;

        return (
            <div className="chips-container">
                {completed.map((item, index) => (
                    <div key={`completed-${item.patientId}-${index}`} className="summary-chip-wrapper">
                        <PatientChip patient={{ type: item.type, status: 'treated', waitingTime: 0 } as any} />
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="turn-summary-panel">
            <h3>Turn Summary</h3>

            <div className="summary-section">
                <h4>New Arrivals</h4>
                {renderArrivalChips()}
            </div>

            <div className="summary-section">
                <h4>Turned Away</h4>
                {renderTurnedAwayChips()}
            </div>

            <div className="summary-section">
                <h4>Risk Events</h4>
                {renderRiskChips()}
            </div>

            <div className="summary-section">
                <h4>Completed Treatments</h4>
                {renderCompletedChips()}
            </div>
        </div>
    );
}
