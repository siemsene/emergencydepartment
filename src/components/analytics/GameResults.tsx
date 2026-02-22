import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ComposedChart, Scatter, Line, BarChart, Bar, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Session, PlayerResult } from '../../types';
import { getSession, getSessionPlayers } from '../../services/firebaseService';
import {
  formatCurrency,
  calculateProfit,
  calculateAverageUtilization,
  calculateAverageQueueLength,
  calculateMaxQueueLength,
  calculateMismatchPercentage
} from '../../utils/gameUtils';
import { Button } from '../shared/Button';
import './GameResults.css';

function linearRegression<T>(data: T[], xKey: keyof T, yKey: keyof T): { x: number; y: number }[] {
  const n = data.length;
  if (n < 2) return [];
  const xs = data.map(d => Number(d[xKey]));
  const ys = data.map(d => Number(d[yKey]));
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return [];
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return [
    { x: minX, y: slope * minX + intercept },
    { x: maxX, y: slope * maxX + intercept }
  ];
}

function polyRegression<T>(data: T[], xKey: keyof T, yKey: keyof T, steps = 30): { x: number; y: number }[] {
  const n = data.length;
  if (n < 3) return [];
  const xs = data.map(d => Number(d[xKey]));
  const ys = data.map(d => Number(d[yKey]));
  // Solve for y = a + bx + cx² using normal equations + Cramer's rule
  let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i], x2 = x * x;
    sx += x; sx2 += x2; sx3 += x2 * x; sx4 += x2 * x2;
    sy += y; sxy += x * y; sx2y += x2 * y;
  }
  const M = [
    [n, sx, sx2],
    [sx, sx2, sx3],
    [sx2, sx3, sx4]
  ];
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M);
  if (Math.abs(D) < 1e-10) return [];
  const R = [sy, sxy, sx2y];
  const replaceCol = (col: number) => M.map((row, i) => row.map((v, j) => j === col ? R[i] : v));
  const a = det3(replaceCol(0)) / D;
  const b = det3(replaceCol(1)) / D;
  const c = det3(replaceCol(2)) / D;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = minX + (maxX - minX) * (i / steps);
    pts.push({ x, y: a + b * x + c * x * x });
  }
  return pts;
}

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
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [staffingByPlayer, setStaffingByPlayer] = useState<Record<string, { high: number; medium: number; low: number }>>({});
  const [riskEventsByPlayer, setRiskEventsByPlayer] = useState<Record<string, { A: number; B: number; C: number }>>({});
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
        patientsTreated: player.gameState.stats.patientsTreated,
        staffingCost: player.gameState.staffingCost,
        waitingCosts: player.gameState.stats.waitingCosts
      }));

      // Build staffing map from player room data
      const staffing: Record<string, { high: number; medium: number; low: number }> = {};
      playersData.forEach(player => {
        const rooms = player.gameState.rooms;
        staffing[player.id] = {
          high: rooms.filter(r => r.type === 'high').length,
          medium: rooms.filter(r => r.type === 'medium').length,
          low: rooms.filter(r => r.type === 'low').length
        };
      });
      setStaffingByPlayer(staffing);

      // Build risk events map (A = cardiac arrests, B/C = LWBS)
      const riskEvents: Record<string, { A: number; B: number; C: number }> = {};
      playersData.forEach(player => {
        const stats = player.gameState.stats;
        riskEvents[player.id] = {
          A: stats.cardiacArrests,
          B: stats.lwbs.B,
          C: stats.lwbs.C
        };
      });
      setRiskEventsByPlayer(riskEvents);

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
  // Staffing by player, ordered by profit (results is already sorted by profit desc)
  // Risk events by player, ordered by profit
  const riskEventsChartData = results.map(r => {
    const e = riskEventsByPlayer[r.playerId] || { A: 0, B: 0, C: 0 };
    return {
      name: r.playerName,
      'Type A (Cardiac Arrest)': e.A,
      'Type B (LWBS)': e.B,
      'Type C (LWBS)': e.C
    };
  });

  const staffingChartData = results.map(r => {
    const s = staffingByPlayer[r.playerId] || { high: 0, medium: 0, low: 0 };
    return {
      name: r.playerName,
      'Type A (High)': s.high,
      'Type B (Medium)': s.medium,
      'Type C (Low)': s.low
    };
  });

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

  const scatterWaitVsStaffingData = results.map(r => ({
    name: r.playerName,
    waitingCosts: r.waitingCosts,
    staffingCost: r.staffingCost
  }));

  const showTrendLine = results.length > 5;
  const trendUtilQueue = showTrendLine
    ? linearRegression(scatterUtilQueueData, 'utilization', 'queueLength') : [];
  const trendUtilProfit = showTrendLine
    ? polyRegression(scatterUtilProfitData, 'utilization', 'profit') : [];
  const trendMismatchProfit = showTrendLine
    ? linearRegression(scatterMismatchProfitData, 'mismatch', 'profit') : [];
  const trendWaitStaffing = showTrendLine
    ? linearRegression(scatterWaitVsStaffingData, 'staffingCost', 'waitingCosts') : [];

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
              <span>Player</span>
              <span>Profit</span>
              <span>Util %</span>
              <span>Queue<br/>(avg/max)</span>
              <span>Treated<br/>(A/B/C)</span>
              <span>Cardiac<br/>Arrests</span>
              <span>Mismatch</span>
              <span>Max Wait<br/>(A/B/C)</span>
            </div>
            {results.map((result, index) => (
              <div
                key={result.playerId}
                className={`table-row ${playerId === result.playerId ? 'highlight' : ''} ${index < 3 ? `rank-${index + 1}` : ''}`}
              >
                <span className="player-name">
                  <span className="rank">{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}</span>
                  {result.playerName}
                </span>
                <span className={`profit ${result.totalProfit >= 0 ? 'positive' : 'negative'}`}>
                  {formatCurrency(result.totalProfit, session.parameters.currencySymbol || '$')}
                </span>
                <span>{result.avgUtilization.toFixed(1)}%</span>
                <span>{result.avgQueueLength.toFixed(1)}/{result.maxQueueLength}</span>
                <span>{result.patientsTreated.A}/{result.patientsTreated.B}/{result.patientsTreated.C}</span>
                <span className={result.cardiacArrests > 0 ? 'danger' : ''}>
                  {result.cardiacArrests}
                </span>
                <span>{result.mismatchCount}</span>
                <span>{result.maxWaitingTime.A}/{result.maxWaitingTime.B}/{result.maxWaitingTime.C} hrs</span>
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
              <ComposedChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" name="Utilization" unit="%" />
                <YAxis type="number" dataKey="y" name="Queue Length" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Players" data={scatterUtilQueueData.map(d => ({ ...d, x: d.utilization, y: d.queueLength }))} fill="#3b82f6" />
                {showTrendLine && (
                  <Line data={trendUtilQueue} dataKey="y" stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 3" dot={false} legendType="none" tooltipType="none" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Utilization vs Profit */}
          <div className="chart-card">
            <h3>Utilization vs Profit</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" name="Utilization" unit="%" />
                <YAxis type="number" dataKey="y" name="Profit" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Players" data={scatterUtilProfitData.map(d => ({ ...d, x: d.utilization, y: d.profit }))} fill="#22c55e" />
                {showTrendLine && (
                  <Line data={trendUtilProfit} dataKey="y" stroke="#22c55e" strokeWidth={2} strokeDasharray="6 3" dot={false} legendType="none" tooltipType="none" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Mismatch vs Profit */}
          <div className="chart-card">
            <h3>Mismatch % vs Profit</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" name="Mismatch" unit="%" />
                <YAxis type="number" dataKey="y" name="Profit" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Players" data={scatterMismatchProfitData.map(d => ({ ...d, x: d.mismatch, y: d.profit }))} fill="#f59e0b" />
                {showTrendLine && (
                  <Line data={trendMismatchProfit} dataKey="y" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={false} legendType="none" tooltipType="none" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Wait Cost vs Staffing Cost */}
          <div className="chart-card">
            <h3>Wait Cost vs Staffing Cost</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" name="Staffing Cost" />
                <YAxis type="number" dataKey="y" name="Wait Cost" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Players" data={scatterWaitVsStaffingData.map(d => ({ ...d, x: d.staffingCost, y: d.waitingCosts }))} fill="#8b5cf6" />
                {showTrendLine && (
                  <Line data={trendWaitStaffing} dataKey="y" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="6 3" dot={false} legendType="none" tooltipType="none" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Staffing by Player (ordered by profit) */}
          <div className="chart-card wide">
            <h3>Room Staffing by Player (Ordered by Profit)</h3>
            <ResponsiveContainer width="100%" height={Math.max(150, staffingChartData.length * 40 + 60)}>
              <BarChart
                data={staffingChartData}
                layout="vertical"
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Type A (High)" stackId="rooms" fill="#dc2626" />
                <Bar dataKey="Type B (Medium)" stackId="rooms" fill="#eab308" />
                <Bar dataKey="Type C (Low)" stackId="rooms" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Risk Events by Player (ordered by profit) */}
          <div className="chart-card wide">
            <h3>Risk Events by Player (Ordered by Profit)</h3>
            <ResponsiveContainer width="100%" height={Math.max(150, riskEventsChartData.length * 40 + 60)}>
              <BarChart
                data={riskEventsChartData}
                layout="vertical"
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Type A (Cardiac Arrest)" stackId="events" fill="#dc2626" />
                <Bar dataKey="Type B (LWBS)" stackId="events" fill="#eab308" />
                <Bar dataKey="Type C (LWBS)" stackId="events" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
