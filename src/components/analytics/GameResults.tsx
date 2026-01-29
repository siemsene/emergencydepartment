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
        cardiacArrests: player.gameState.stats.cardiacArrests,
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
      cardiacArrests: r.cardiacArrests,
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
    const avgCapacity = {
      A: results.reduce((sum, r) => {
        const aRooms = players.find(p => p.id === r.playerId)?.gameState.rooms.filter(rm => rm.type === 'high').length || 0;
        return sum + aRooms;
      }, 0) / results.length,
      B: results.reduce((sum, r) => {
        const rooms = players.find(p => p.id === r.playerId)?.gameState.rooms.filter(rm => rm.type === 'high' || rm.type === 'medium').length || 0;
        return sum + rooms;
      }, 0) / results.length,
      C: results.reduce((sum, r) => {
        const rooms = players.find(p => p.id === r.playerId)?.gameState.rooms.length || 0;
        return sum + rooms;
      }, 0) / results.length
    };

    return {
      hour: HOURS_OF_DAY[i],
      'Demand A': arrival.A,
      'Demand B': arrival.B,
      'Demand C': arrival.C,
      'Capacity A': avgCapacity.A,
      'Capacity B': avgCapacity.B,
      'Capacity C': avgCapacity.C
    };
  });

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
        {!playerId && (
          <div className="header-actions">
            <Button variant="secondary" onClick={handleDownloadData}>
              Download Data (CSV)
            </Button>
            <Button variant="primary" onClick={handleExportPDF} loading={isExporting}>
              Export PDF
            </Button>
          </div>
        )}
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
              <span>Avg Queue</span>
              <span>Cardiac Arrests</span>
              <span>Mismatch %</span>
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
                  {formatCurrency(result.totalProfit)}
                </span>
                <span>{result.avgUtilization.toFixed(1)}%</span>
                <span>{result.avgQueueLength.toFixed(1)}</span>
                <span className={result.cardiacArrests > 0 ? 'danger' : ''}>
                  {result.cardiacArrests}
                </span>
                <span>{result.mismatchPercentage.toFixed(1)}%</span>
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
                <Legend />
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
