import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ScatterChart, Scatter, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Session, Player, PlayerResult } from '../../types';
import { getSession, getSessionPlayers } from '../../services/firebaseService';
import {
  formatCurrency,
  calculateProfit,
  calculateAverageUtilization,
  calculateAverageQueueLength,
  calculateMaxQueueLength,
  calculateMismatchPercentage
} from '../../utils/gameUtils';
import { HOURS_OF_DAY } from '../../data/gameConstants';
import { Button } from '../shared/Button';
import './GameResults.css';

interface GameResultsProps {
  sessionId?: string;
  playerId?: string;
}

export function GameResults({ sessionId: propSessionId, playerId }: GameResultsProps) {
  const { sessionId: paramSessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const resultsRef = useRef<HTMLDivElement>(null);

  const sessionId = propSessionId || paramSessionId;

  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    loadResults();
  }, [sessionId]);

  const loadResults = async () => {
    try {
      const sessionData = await getSession(sessionId!);
      const playersData = await getSessionPlayers(sessionId!);

      setSession(sessionData);
      setPlayers(playersData);

      // Calculate results for each player
      const playerResults: PlayerResult[] = playersData.map(player => ({
        playerId: player.id,
        playerName: player.name,
        totalProfit: calculateProfit(player.gameState.totalRevenue, player.gameState.totalCost),
        totalRevenue: player.gameState.totalRevenue,
        totalCost: player.gameState.totalCost,
        avgUtilization: calculateAverageUtilization(player.gameState.stats.hourlyUtilization) * 100,
        avgQueueLength: calculateAverageQueueLength(player.gameState.stats.hourlyQueueLength),
        maxQueueLength: calculateMaxQueueLength(player.gameState.stats.hourlyQueueLength),
        cardiacArrests: player.gameState.stats.cardiacArrests,
        mismatchCount: player.gameState.stats.mismatchTreatments,
        mismatchPercentage: calculateMismatchPercentage(
          player.gameState.stats.mismatchTreatments,
          player.gameState.stats.totalTreatments
        ),
        maxWaitingTime: player.gameState.stats.maxWaitingTime,
        patientsTreated: player.gameState.stats.patientsTreated
      }));

      // Sort by profit
      playerResults.sort((a, b) => b.totalProfit - a.totalProfit);
      setResults(playerResults);
    } catch (err) {
      console.error('Error loading results:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadData = () => {
    const data = results.map(r => ({
      name: r.playerName,
      profit: r.totalProfit,
      revenue: r.totalRevenue,
      cost: r.totalCost,
      avgUtilization: r.avgUtilization.toFixed(2),
      avgQueueLength: r.avgQueueLength.toFixed(2),
      maxQueueLength: r.maxQueueLength,
      cardiacArrests: r.cardiacArrests,
      mismatchCount: r.mismatchCount,
      mismatchPercent: r.mismatchPercentage.toFixed(2),
      maxWaitA: r.maxWaitingTime.A,
      maxWaitB: r.maxWaitingTime.B,
      maxWaitC: r.maxWaitingTime.C,
      treatedA: r.patientsTreated.A,
      treatedB: r.patientsTreated.B,
      treatedC: r.patientsTreated.C
    }));

    const csv = [
      Object.keys(data[0]).join(','),
      ...data.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emergency-game-results-${session?.code || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    if (!resultsRef.current) return;

    setIsExporting(true);
    try {
      const canvas = await html2canvas(resultsRef.current, {
        scale: 2,
        useCORS: true,
        logging: false
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`emergency-game-results-${session?.code || 'export'}.pdf`);
    } catch (err) {
      console.error('Error exporting PDF:', err);
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return <div className="results-loading">Loading results...</div>;
  }

  if (!session || results.length === 0) {
    return <div className="results-error">No results found</div>;
  }

  // Prepare chart data
  const scatterUtilQueueData = results.map(r => ({
    name: r.playerName,
    utilization: r.avgUtilization,
    queueLength: r.avgQueueLength
  }));

  const scatterUtilProfitData = results.map(r => ({
    name: r.playerName,
    utilization: r.avgUtilization,
    profit: r.totalProfit
  }));

  const scatterMismatchProfitData = results.map(r => ({
    name: r.playerName,
    mismatch: r.mismatchPercentage,
    profit: r.totalProfit
  }));

  // Demand vs capacity time series
  const demandCapacityData = session.arrivals.map((arrival, i) => {
    // Capacity: Available (empty) rooms of each primary type
    // Falls back to total rooms of that type for older sessions
    const getAvgCapacity = (type: 'A' | 'B' | 'C') => {
      const roomTypeMap = { A: 'high', B: 'medium', C: 'low' };
      const totalAvailable = results.reduce((sum, r) => {
        const p = players.find(plr => plr.id === r.playerId);
        const recordedAvailable = p?.gameState.stats.hourlyAvailableCapacity?.[type]?.[i];

        if (recordedAvailable !== undefined) {
          return sum + recordedAvailable;
        }

        // Fallback to total rooms of that type if availability wasn't recorded
        const totalRoomsOfType = p?.gameState.rooms.filter(rm => rm.type === roomTypeMap[type]).length || 0;
        return sum + totalRoomsOfType;
      }, 0);
      return totalAvailable / results.length;
    };

    // Demand: New arrivals + anyone still waiting from the previous hour
    // We average this across all players to show typical demand
    const getAvgDemand = (type: 'A' | 'B' | 'C') => {
      const totalDemand = results.reduce((sum, r) => {
        const p = players.find(plr => plr.id === r.playerId);
        const hourlyDemand = p?.gameState.stats.hourlyDemand?.[type]?.[i];
        // If we have precise demand data (arrivals + waiting), use it.
        // Falls back to just arrivals for backwards compatibility with old sessions.
        return sum + (hourlyDemand !== undefined ? hourlyDemand : arrival[type]);
      }, 0);
      return totalDemand / results.length;
    };

    return {
      hour: HOURS_OF_DAY[i],
      'Demand A': getAvgDemand('A'),
      'Demand B': getAvgDemand('B'),
      'Demand C': getAvgDemand('C'),
      'Capacity A': getAvgCapacity('A'),
      'Capacity B': getAvgCapacity('B'),
      'Capacity C': getAvgCapacity('C')
    };
  });

  const renderDemandCapacityLegend = (props: any) => {
    const items = props.payload ?? [];
    if (items.length === 0) return null;

    return (
      <div className="demand-capacity-legend">
        <div className="legend-items">
          {items.map((entry: any) => {
            const label = String(entry.value ?? entry.dataKey ?? '');
            const isCapacity = label.startsWith('Capacity');
            return (
              <div key={label} className="legend-item">
                <svg className="legend-swatch" viewBox="0 0 32 6" aria-hidden="true">
                  <line
                    x1="0"
                    y1="3"
                    x2="32"
                    y2="3"
                    stroke={entry.color}
                    strokeWidth="3"
                    strokeDasharray={isCapacity ? '6 4' : undefined}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="legend-label">{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="game-results">
      <header className="results-header">
        <div className="header-left">
          {!playerId && (
            <Button variant="secondary" size="small" onClick={() => navigate('/instructor/dashboard')}>
              &larr; Back
            </Button>
          )}
          <h1>Game Results</h1>
          <span className="session-name">{session.name}</span>
        </div>
        <div className="header-actions">
          {!playerId ? (
            <>
              <Button variant="secondary" onClick={handleDownloadData}>
                Download Data (CSV)
              </Button>
              <Button variant="primary" onClick={handleExportPDF} loading={isExporting}>
                Export PDF
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => navigate('/')}>
              Join New Session
            </Button>
          )}
        </div>
      </header>

      <div className="results-content" ref={resultsRef}>
        {/* Leaderboard */}
        <div className="results-section leaderboard">
          <h2>Leaderboard</h2>
          <div className="leaderboard-table">
            <div className="table-header">
              <span>Rank</span>
              <span>Player</span>
              <span>Profit</span>
              <span>Avg Utilization</span>
              <span>Avg/Max Queue</span>
              <span>Cardiac Arrests</span>
              <span>Mismatches</span>
              <span>Max Wait (A/B/C)</span>
            </div>
            {results.map((result, index) => (
              <div
                key={result.playerId}
                className={`table-row ${playerId === result.playerId ? 'highlight' : ''} ${index < 3 ? `rank-${index + 1}` : ''}`}
              >
                <span className="rank">
                  {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                </span>
                <span className="player-name">{result.playerName}</span>
                <span className={`profit ${result.totalProfit >= 0 ? 'positive' : 'negative'}`}>
                  {formatCurrency(result.totalProfit, session.parameters.currencySymbol || '$')}
                </span>
                <span>{result.avgUtilization.toFixed(1)}%</span>
                <span>{result.avgQueueLength.toFixed(1)} / {result.maxQueueLength}</span>
                <span className={result.cardiacArrests > 0 ? 'danger' : ''}>
                  {result.cardiacArrests}
                </span>
                <span>{result.mismatchCount}</span>
                <span>{result.maxWaitingTime.A}/{result.maxWaitingTime.B}/{result.maxWaitingTime.C}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Charts Grid */}
        <div className="charts-grid">
          {/* Utilization vs Queue Length */}
          <div className="chart-card">
            <h3>Utilization vs Queue Length</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="utilization" name="Utilization" unit="%" />
                <YAxis type="number" dataKey="queueLength" name="Queue Length" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Players" data={scatterUtilQueueData} fill="#3b82f6" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Utilization vs Profit */}
          <div className="chart-card">
            <h3>Utilization vs Profit</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="utilization" name="Utilization" unit="%" />
                <YAxis type="number" dataKey="profit" name="Profit" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Players" data={scatterUtilProfitData} fill="#22c55e" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Mismatch vs Profit */}
          <div className="chart-card">
            <h3>Mismatch % vs Profit</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="mismatch" name="Mismatch" unit="%" />
                <YAxis type="number" dataKey="profit" name="Profit" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Players" data={scatterMismatchProfitData} fill="#f59e0b" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Demand vs Capacity Time Series */}
          <div className="chart-card wide">
            <h3>Demand vs Capacity Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={demandCapacityData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" angle={-45} textAnchor="end" interval={1} tick={{ fontSize: 10 }} />
                <YAxis />
                <Tooltip />
                <Legend content={renderDemandCapacityLegend} />
                <Line type="monotone" dataKey="Demand A" stroke="#dc2626" strokeWidth={2} />
                <Line type="monotone" dataKey="Demand B" stroke="#eab308" strokeWidth={2} />
                <Line type="monotone" dataKey="Demand C" stroke="#2563eb" strokeWidth={2} />
                <Line type="monotone" dataKey="Capacity A" stroke="#dc2626" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="Capacity B" stroke="#eab308" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="Capacity C" stroke="#2563eb" strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
