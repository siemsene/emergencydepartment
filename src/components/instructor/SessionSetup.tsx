import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { Session, GameParameters, HourlyArrivals, Player } from '../../types';
import {
  getSession,
  subscribeToSessionPlayers,
  updateSessionParameters,
  updateSessionArrivals,
  startSession,
  kickPlayer
} from '../../services/firebaseService';
import { generateArrivals, calculateArrivalsTotals } from '../../utils/gameUtils';
import { PREGENERATED_ARRIVALS } from '../../data/pregeneratedArrivals';
import { DEFAULT_PARAMETERS, HOURS_OF_DAY } from '../../data/gameConstants';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Modal } from '../shared/Modal';
import './SessionSetup.css';

export function SessionSetup() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { instructor } = useAuth();

  const [session, setSession] = useState<Session | null>(null);
  const [parameters, setParameters] = useState<GameParameters>(DEFAULT_PARAMETERS);
  const [arrivals, setArrivals] = useState<HourlyArrivals[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [usePregenerated, setUsePregenerated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [kickPlayerId, setKickPlayerId] = useState<string | null>(null);
  const [isKicking, setIsKicking] = useState(false);

  useEffect(() => {
    loadSession();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = subscribeToSessionPlayers(sessionId, (updatedPlayers) => {
      setPlayers(updatedPlayers);
    });

    return () => unsubscribe();
  }, [sessionId]);

  const loadSession = async () => {
    if (!sessionId) return;

    try {
      const sessionData = await getSession(sessionId);
      if (sessionData) {
        setSession(sessionData);
        setParameters(sessionData.parameters);
        if (sessionData.arrivals.length > 0) {
          setArrivals(sessionData.arrivals);
          setUsePregenerated(sessionData.usePregenerated);
        } else {
          handleGenerateArrivals(sessionData.parameters);
        }
      }
    } catch (err) {
      console.error('Error loading session:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateArrivals = useCallback((params: GameParameters = parameters) => {
    const newArrivals = generateArrivals(params);
    setArrivals(newArrivals);
    setUsePregenerated(false);
  }, [parameters]);

  const handleUsePregeneratedData = () => {
    setArrivals(PREGENERATED_ARRIVALS);
    setUsePregenerated(true);
  };

  const handleParameterChange = (key: string, value: number, subKey?: string) => {
    setParameters(prev => {
      if (subKey) {
        return {
          ...prev,
          [key]: {
            ...(prev[key as keyof GameParameters] as any),
            [subKey]: value
          }
        };
      }
      return { ...prev, [key]: value };
    });
  };

  const handleWeightChange = (index: number, value: number) => {
    setParameters(prev => ({
      ...prev,
      hourlyWeights: prev.hourlyWeights.map((w, i) => i === index ? value : w)
    }));
  };

  const handleSaveParameters = async () => {
    if (!sessionId) return;

    setIsSaving(true);
    try {
      await updateSessionParameters(sessionId, parameters);
      await updateSessionArrivals(sessionId, arrivals, usePregenerated);
    } catch (err) {
      console.error('Error saving parameters:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartSession = async () => {
    if (!sessionId) return;

    await handleSaveParameters();
    await startSession(sessionId);
    navigate(`/instructor/session/${sessionId}/monitor`);
  };

  const handleKickPlayer = async () => {
    if (!kickPlayerId) return;
    setIsKicking(true);
    try {
      await kickPlayer(kickPlayerId);
    } catch (err) {
      console.error('Error kicking player:', err);
    } finally {
      setIsKicking(false);
      setKickPlayerId(null);
    }
  };

  const totals = calculateArrivalsTotals(arrivals);

  // Prepare chart data
  const chartData = arrivals.map((a, i) => ({
    hour: HOURS_OF_DAY[i],
    'Type A (High)': a.A,
    'Type B (Medium)': a.B,
    'Type C (Low)': a.C
  }));

  if (isLoading) {
    return <div className="setup-loading">Loading session...</div>;
  }

  if (!session) {
    return <div className="setup-error">Session not found</div>;
  }

  return (
    <div className="session-setup">
      <header className="setup-header">
        <div className="header-left">
          <Button variant="secondary" size="small" onClick={() => navigate('/instructor/dashboard')}>
            &larr; Back
          </Button>
          <h1>{session.name}</h1>
        </div>
        <div className="header-right">
          <span className="session-code">Code: <strong>{session.code}</strong></span>
        </div>
      </header>

      <div className="setup-content">
        <div className="setup-grid">
          {/* Parameters Panel */}
          <div className="parameters-panel">
            <h2>Game Parameters</h2>

            <div className="param-section">
              <h3>Daily Arrivals</h3>
              <div className="param-row">
                <Input
                  label="Type A (High)"
                  type="number"
                  value={parameters.dailyArrivals.A}
                  onChange={(e) => handleParameterChange('dailyArrivals', Number(e.target.value), 'A')}
                />
                <Input
                  label="Type B (Medium)"
                  type="number"
                  value={parameters.dailyArrivals.B}
                  onChange={(e) => handleParameterChange('dailyArrivals', Number(e.target.value), 'B')}
                />
                <Input
                  label="Type C (Low)"
                  type="number"
                  value={parameters.dailyArrivals.C}
                  onChange={(e) => handleParameterChange('dailyArrivals', Number(e.target.value), 'C')}
                />
              </div>
            </div>

            <div className="param-section">
              <h3>Revenue per Patient</h3>
              <div className="param-row">
                <Input
                  label="Type A"
                  type="number"
                  value={parameters.revenuePerPatient.A}
                  onChange={(e) => handleParameterChange('revenuePerPatient', Number(e.target.value), 'A')}
                />
                <Input
                  label="Type B"
                  type="number"
                  value={parameters.revenuePerPatient.B}
                  onChange={(e) => handleParameterChange('revenuePerPatient', Number(e.target.value), 'B')}
                />
                <Input
                  label="Type C"
                  type="number"
                  value={parameters.revenuePerPatient.C}
                  onChange={(e) => handleParameterChange('revenuePerPatient', Number(e.target.value), 'C')}
                />
              </div>
            </div>

            <div className="param-section">
              <h3>Waiting Cost per Hour</h3>
              <div className="param-row">
                <Input
                  label="Type A"
                  type="number"
                  value={parameters.waitingCostPerHour.A}
                  onChange={(e) => handleParameterChange('waitingCostPerHour', Number(e.target.value), 'A')}
                />
                <Input
                  label="Type B"
                  type="number"
                  value={parameters.waitingCostPerHour.B}
                  onChange={(e) => handleParameterChange('waitingCostPerHour', Number(e.target.value), 'B')}
                />
                <Input
                  label="Type C"
                  type="number"
                  value={parameters.waitingCostPerHour.C}
                  onChange={(e) => handleParameterChange('waitingCostPerHour', Number(e.target.value), 'C')}
                />
              </div>
            </div>

            <div className="param-section">
              <h3>Risk Event Cost</h3>
              <div className="param-row">
                <Input
                  label="Type A"
                  type="number"
                  value={parameters.riskEventCost.A}
                  onChange={(e) => handleParameterChange('riskEventCost', Number(e.target.value), 'A')}
                />
                <Input
                  label="Type B"
                  type="number"
                  value={parameters.riskEventCost.B}
                  onChange={(e) => handleParameterChange('riskEventCost', Number(e.target.value), 'B')}
                />
                <Input
                  label="Type C"
                  type="number"
                  value={parameters.riskEventCost.C}
                  onChange={(e) => handleParameterChange('riskEventCost', Number(e.target.value), 'C')}
                />
              </div>
            </div>

            <div className="param-section">
              <h3>Other Settings</h3>
              <div className="param-row">
                <Input
                  label="Max Waiting Room"
                  type="number"
                  value={parameters.maxWaitingRoom}
                  onChange={(e) => handleParameterChange('maxWaitingRoom', Number(e.target.value))}
                />
                <Input
                  label="Max Budget"
                  type="number"
                  value={parameters.maxStaffingBudget}
                  onChange={(e) => handleParameterChange('maxStaffingBudget', Number(e.target.value))}
                />
              </div>
            </div>

            <button
              className="advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Settings (Hourly Weights)
            </button>

            {showAdvanced && (
              <motion.div
                className="param-section weights-section"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              >
                <h3>Hourly Arrival Weights</h3>
                <p className="weights-note">
                  Sum: {parameters.hourlyWeights.reduce((a, b) => a + b, 0).toFixed(4)} (should be close to 1.0)
                </p>
                <div className="weights-grid">
                  {parameters.hourlyWeights.map((weight, i) => (
                    <div key={i} className="weight-input">
                      <label>{HOURS_OF_DAY[i]}</label>
                      <input
                        type="number"
                        step="0.001"
                        value={weight}
                        onChange={(e) => handleWeightChange(i, Number(e.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            <div className="param-actions">
              <Button variant="secondary" onClick={() => handleGenerateArrivals()}>
                Regenerate Arrivals
              </Button>
              <Button variant="secondary" onClick={handleUsePregeneratedData}>
                Use Standard Dataset
              </Button>
            </div>
          </div>

          {/* Arrivals Chart Panel */}
          <div className="arrivals-panel">
            <h2>Patient Arrivals Preview</h2>

            <div className="arrivals-summary">
              <div className="summary-item">
                <span className="summary-label">Total Type A</span>
                <span className="summary-value type-a">{totals.A}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Type B</span>
                <span className="summary-value type-b">{totals.B}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Type C</span>
                <span className="summary-value type-c">{totals.C}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Grand Total</span>
                <span className="summary-value">{totals.total}</span>
              </div>
            </div>

            {usePregenerated && (
              <div className="pregenerated-badge">Using Standard Dataset</div>
            )}

            <div className="chart-container">
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="hour"
                    angle={-45}
                    textAnchor="end"
                    interval={0}
                    height={60}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Type A (High)" stackId="a" fill="#dc2626" />
                  <Bar dataKey="Type B (Medium)" stackId="a" fill="#eab308" />
                  <Bar dataKey="Type C (Low)" stackId="a" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="proportions">
              <h4>Effective Proportions</h4>
              <div className="proportion-row">
                <span className="prop-label">Type A:</span>
                <span className="prop-value">{totals.total > 0 ? ((totals.A / totals.total) * 100).toFixed(1) : 0}%</span>
              </div>
              <div className="proportion-row">
                <span className="prop-label">Type B:</span>
                <span className="prop-value">{totals.total > 0 ? ((totals.B / totals.total) * 100).toFixed(1) : 0}%</span>
              </div>
              <div className="proportion-row">
                <span className="prop-label">Type C:</span>
                <span className="prop-value">{totals.total > 0 ? ((totals.C / totals.total) * 100).toFixed(1) : 0}%</span>
              </div>
            </div>

          </div>
        </div>

        <div className="registered-players-card">
          <h2>Registered Players ({players.length})</h2>
          <div className="setup-players-table">
            <div className="table-header">
              <span>Name</span>
              <span>Status</span>
              <span>Joined</span>
              <span>Actions</span>
            </div>
            {players.length === 0 ? (
              <div className="no-players">
                No players have joined yet. Share the session code to get started.
              </div>
            ) : (
              players.map((player) => (
                <div key={player.id} className="table-row">
                  <span className="player-name">{player.name}</span>
                  <span className={`connection-status ${player.isConnected ? 'connected' : 'disconnected'}`}>
                    {player.isConnected ? 'Online' : 'Offline'}
                  </span>
                  <span className="joined-at">
                    {player.joinedAt?.toLocaleString?.() || '—'}
                  </span>
                  <button
                    className="kick-player-btn"
                    onClick={() => setKickPlayerId(player.id)}
                  >
                    Kick
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="setup-actions">
          <Button variant="success" size="large" onClick={handleStartSession} loading={isSaving}>
            Start Session
          </Button>
        </div>
      </div>

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
          <Button variant="danger" onClick={handleKickPlayer} loading={isKicking}>
            Kick Player
          </Button>
        </div>
      </Modal>
    </div>
  );
}
