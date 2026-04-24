import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ComposedChart, Scatter, Line, BarChart, Bar, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Session, PlayerResult, Player } from '../../types';
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

const formatCompact = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
};

interface GameResultsProps {
  sessionId?: string;
  playerId?: string;
}

export function GameResults({ sessionId: propSessionId, playerId }: GameResultsProps) {
  const { sessionId: paramSessionId, playerId: paramPlayerId } = useParams<{ sessionId: string; playerId?: string }>();
  const navigate = useNavigate();
  const resultsRef = useRef<HTMLDivElement>(null);

  const sessionId = propSessionId || paramSessionId;
  const effectivePlayerId = playerId || paramPlayerId;

  const [session, setSession] = useState<Session | null>(null);
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [staffingByPlayer, setStaffingByPlayer] = useState<Record<string, { high: number; medium: number; low: number }>>({});
  const [riskEventsByPlayer, setRiskEventsByPlayer] = useState<Record<string, { A: number; B: number; C: number }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [rawPlayers, setRawPlayers] = useState<Player[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    loadResults();
  }, [sessionId]);

  const loadResults = async () => {
    try {
      const sessionData = await getSession(sessionId!);
      const playersData = await getSessionPlayers(sessionId!);

      setSession(sessionData);
      setRawPlayers(playersData);

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
        waitingCosts: player.gameState.stats.waitingCosts,
        riskEventCosts: player.gameState.stats.riskEventCosts,
        hoursCompleted: player.gameState.lastCompletedHour ?? 0
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

  const handleDownloadExcel = async () => {
    if (!session || results.length === 0) return;
    setIsExportingExcel(true);

    try {
      const [ExcelJS, html2canvasLib] = await Promise.all([
        import('exceljs'),
        import('html2canvas')
      ]);
      const html2canvas = html2canvasLib.default;
      const workbook = new ExcelJS.Workbook();
      const currency = session.parameters.currencySymbol || '$';

      // Sort rawPlayers by profit to match results order
      const sortedPlayers = [...rawPlayers].sort((a, b) => {
        const profitA = calculateProfit(a.gameState.totalRevenue, a.gameState.totalCost);
        const profitB = calculateProfit(b.gameState.totalRevenue, b.gameState.totalCost);
        return profitB - profitA;
      });

      // ── Sheet 1: Summary ──
      const summarySheet = workbook.addWorksheet('Summary');

      // Title row
      summarySheet.mergeCells('A1:N1');
      const titleCell = summarySheet.getCell('A1');
      titleCell.value = `${session.name} — Code: ${session.code}`;
      titleCell.font = { bold: true, size: 16, color: { argb: 'FF1E293B' } };
      titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
      summarySheet.getRow(1).height = 30;

      // Header row
      const summaryHeaders = [
        'Rank', 'Player', 'Profit', 'Revenue', 'Cost', 'Utilization %',
        'Avg Queue', 'Max Queue', 'Treated A', 'Treated B', 'Treated C',
        'Cardiac Arrests', 'Mismatches', 'Max Wait A/B/C'
      ];
      const headerRow = summarySheet.addRow(summaryHeaders);
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FF94A3B8' } }
        };
      });
      headerRow.height = 24;

      // Data rows
      results.forEach((r, idx) => {
        const row = summarySheet.addRow([
          idx + 1,
          r.playerName,
          r.totalProfit,
          r.totalRevenue,
          r.totalCost,
          Number(r.avgUtilization.toFixed(1)),
          Number(r.avgQueueLength.toFixed(1)),
          r.maxQueueLength,
          r.patientsTreated.A,
          r.patientsTreated.B,
          r.patientsTreated.C,
          r.cardiacArrests,
          r.mismatchCount,
          `${r.maxWaitingTime.A}/${r.maxWaitingTime.B}/${r.maxWaitingTime.C}`
        ]);

        // Profit color
        const profitCell = row.getCell(3);
        profitCell.numFmt = `"${currency}"#,##0`;
        profitCell.font = {
          bold: true,
          color: { argb: r.totalProfit >= 0 ? 'FF16A34A' : 'FFDC2626' }
        };

        // Revenue/Cost formatting
        row.getCell(4).numFmt = `"${currency}"#,##0`;
        row.getCell(5).numFmt = `"${currency}"#,##0`;

        // Alternating row colors
        if (idx % 2 === 1) {
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          });
        }

        row.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      // Column widths
      summarySheet.columns = [
        { width: 6 }, { width: 20 }, { width: 14 }, { width: 14 }, { width: 14 },
        { width: 14 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 10 },
        { width: 10 }, { width: 14 }, { width: 12 }, { width: 16 }
      ];
      summarySheet.views = [{ state: 'frozen', ySplit: 2 }];

      // ── Sheet 2: Hourly Data ──
      const hourlySheet = workbook.addWorksheet('Hourly Data');
      const hourlyHeaders = [
        'Player', 'Hour', 'Utilization', 'Queue Length',
        'Demand A', 'Demand B', 'Demand C',
        'Capacity A', 'Capacity B', 'Capacity C'
      ];
      const hourlyHeaderRow = hourlySheet.addRow(hourlyHeaders);
      hourlyHeaderRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      sortedPlayers.forEach(player => {
        // Player section header
        const sectionRow = hourlySheet.addRow([player.name, '', '', '', '', '', '', '', '', '']);
        sectionRow.eachCell(cell => {
          cell.font = { bold: true, size: 11 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        });

        const stats = player.gameState.stats;
        const hours = stats.hourlyUtilization.length;
        for (let h = 0; h < hours; h++) {
          hourlySheet.addRow([
            player.name,
            h + 1,
            Number((stats.hourlyUtilization[h] * 100).toFixed(1)),
            stats.hourlyQueueLength[h],
            stats.hourlyDemand?.A?.[h] ?? '',
            stats.hourlyDemand?.B?.[h] ?? '',
            stats.hourlyDemand?.C?.[h] ?? '',
            stats.hourlyAvailableCapacity?.A?.[h] ?? '',
            stats.hourlyAvailableCapacity?.B?.[h] ?? '',
            stats.hourlyAvailableCapacity?.C?.[h] ?? ''
          ]);
        }
      });

      hourlySheet.columns = [
        { width: 20 }, { width: 8 }, { width: 12 }, { width: 14 },
        { width: 10 }, { width: 10 }, { width: 10 },
        { width: 12 }, { width: 12 }, { width: 12 }
      ];
      hourlySheet.views = [{ state: 'frozen', ySplit: 1 }];

      // ── Sheet 3: Patient Data ──
      const patientSheet = workbook.addWorksheet('Patient Data');
      const patientHeaders = ['Player', 'Patient ID', 'Type', 'Arrived Hour', 'Waiting Time', 'Mismatch', 'Status'];
      const patientHeaderRow = patientSheet.addRow(patientHeaders);
      patientHeaderRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const typeColors: Record<string, string> = { A: 'FFFEE2E2', B: 'FFFFFBEB', C: 'FFDBEAFE' };
      const statusColors: Record<string, string> = { cardiac_arrest: 'FFDC2626', lwbs: 'FFF97316' };

      sortedPlayers.forEach(player => {
        const patients = player.gameState.completedPatients || [];
        patients.forEach(p => {
          const row = patientSheet.addRow([
            player.name,
            p.id,
            p.type,
            p.arrivedAt,
            p.waitingTime,
            p.treatedInMismatchRoom ? 'Yes' : 'No',
            p.status
          ]);

          // Color by type
          const bgColor = typeColors[p.type];
          if (bgColor) {
            row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor.replace('FF', '') } };
          }

          // Color status cell for adverse outcomes
          const statusColor = statusColors[p.status];
          if (statusColor) {
            row.getCell(7).font = { bold: true, color: { argb: statusColor } };
          }
        });
      });

      patientSheet.columns = [
        { width: 20 }, { width: 16 }, { width: 8 }, { width: 14 },
        { width: 14 }, { width: 10 }, { width: 16 }
      ];
      patientSheet.views = [{ state: 'frozen', ySplit: 1 }];

      // ── Sheet 4: Charts ──
      if (resultsRef.current) {
        const chartsSheet = workbook.addWorksheet('Charts');
        const chartCards = Array.from(resultsRef.current.querySelectorAll('.chart-card')) as HTMLElement[];
        let chartRow = 1;

        for (const card of chartCards) {
          const title = card.querySelector('h3')?.textContent || 'Chart';
          const titleRow = chartsSheet.getRow(chartRow);
          titleRow.getCell(1).value = title;
          titleRow.getCell(1).font = { bold: true, size: 14 };
          chartRow++;

          try {
            const restore = await prepareSvgsForCapture(card);
            try {
              const canvas = await html2canvas(card, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff'
              });
              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
              const imgId = workbook.addImage({ base64: dataUrl.split(',')[1], extension: 'jpeg' });

              // Calculate dimensions (max width ~700px in Excel ≈ 10 columns)
              // Column width 14 ≈ 96px, default row height ≈ 20px, ratio = 96/20 = 4.8
              const aspectRatio = canvas.height / canvas.width;
              const imgWidthCols = 10;
              const imgHeightRows = Math.ceil(imgWidthCols * aspectRatio * 4.8);

              chartsSheet.addImage(imgId, {
                tl: { col: 0, row: chartRow - 1, nativeCol: 0, nativeColOff: 0, nativeRow: chartRow - 1, nativeRowOff: 0 } as never,
                br: { col: imgWidthCols, row: chartRow - 1 + imgHeightRows, nativeCol: imgWidthCols, nativeColOff: 0, nativeRow: chartRow - 1 + imgHeightRows, nativeRowOff: 0 } as never
              } as never);
              chartRow += imgHeightRows + 2;
            } finally {
              restore();
            }
          } catch {
            // Skip chart if capture fails
            chartRow += 2;
          }
        }

        chartsSheet.columns = [
          { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
          { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }
        ];
      }

      // Generate and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `emergency-game-results-${session.code || 'export'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting Excel:', err);
    } finally {
      setIsExportingExcel(false);
    }
  };

  // Inline computed styles onto SVG elements so they survive serialization
  const inlineSvgStyles = (svg: SVGElement) => {
    const styleProps = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'opacity', 'visibility', 'display'];
    const walk = (el: Element) => {
      const computed = window.getComputedStyle(el);
      for (const prop of styleProps) {
        const val = computed.getPropertyValue(prop);
        if (val) (el as HTMLElement).style.setProperty(prop, val);
      }
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(svg);
  };

  // Convert a single SVG element to a canvas element with the same dimensions
  const svgToCanvas = async (svg: SVGElement): Promise<HTMLCanvasElement> => {
    inlineSvgStyles(svg);
    const svgRect = svg.getBoundingClientRect();
    const w = svgRect.width;
    const h = svgRect.height;

    // Clone SVG and set explicit width/height/viewBox so the serialized
    // version renders at the exact same dimensions as the on-screen original
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.width = w;
    img.height = h;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return canvas;
  };

  // Replace all SVGs in a container with canvas elements; returns a restore function
  const prepareSvgsForCapture = async (container: HTMLElement): Promise<() => void> => {
    const svgs = Array.from(container.querySelectorAll('svg'));
    const restorers: (() => void)[] = [];
    for (const svg of svgs) {
      try {
        const canvas = await svgToCanvas(svg as SVGElement);
        const parent = svg.parentElement!;
        parent.insertBefore(canvas, svg);
        svg.style.display = 'none';
        restorers.push(() => {
          svg.style.display = '';
          parent.removeChild(canvas);
        });
      } catch {
        // If conversion fails for one SVG, skip it
      }
    }
    return () => restorers.forEach(r => r());
  };

  const handleExportPDF = async () => {
    if (!resultsRef.current) return;

    setIsExporting(true);

    // Wait for reflow + ResponsiveContainer re-render at new width
    await new Promise(r => setTimeout(r, 500));

    try {
      const [{ jsPDF }, html2canvasLib] = await Promise.all([
        import('jspdf'),
        import('html2canvas')
      ]);
      const html2canvas = html2canvasLib.default;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = 210;
      const pageH = 297;
      const margin = 15;
      const contentW = pageW - margin * 2;
      let cursorY = margin;
      let pageNum = 1;

      const addPageNumber = () => {
        pdf.setFontSize(9);
        pdf.setTextColor(150);
        pdf.text(`Page ${pageNum}`, pageW / 2, pageH - 8, { align: 'center' });
      };

      const ensureSpace = (needed: number) => {
        if (cursorY + needed > pageH - margin - 10) {
          addPageNumber();
          pdf.addPage();
          pageNum++;
          cursorY = margin;
        }
      };

      // Capture a DOM element as an image and add it to the PDF,
      // splitting across pages if the image is taller than available space
      const captureAndAdd = async (el: HTMLElement) => {
        const restore = await prepareSvgsForCapture(el);
        try {
          const canvas = await html2canvas(el, {
            scale: 1.5,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
          });
          const imgW = contentW;
          const fullImgH = (canvas.height * contentW) / canvas.width;
          const maxSliceH = pageH - margin * 2 - 10; // max image height per page

          if (fullImgH <= maxSliceH) {
            // Fits on one page — use ensureSpace as before
            const imgData = canvas.toDataURL('image/jpeg', 0.8);
            ensureSpace(fullImgH);
            pdf.addImage(imgData, 'JPEG', margin, cursorY, imgW, fullImgH);
            cursorY += fullImgH + 8;
          } else {
            // Too tall — slice the canvas into page-sized strips
            const pxPerMm = canvas.width / contentW;
            let srcY = 0;

            while (srcY < canvas.height) {
              const availableMm = pageH - margin - 10 - cursorY;
              const sliceHMm = Math.min(availableMm, maxSliceH);
              const sliceHPx = Math.min(Math.round(sliceHMm * pxPerMm), canvas.height - srcY);

              // Create a sub-canvas for this slice
              const sliceCanvas = document.createElement('canvas');
              sliceCanvas.width = canvas.width;
              sliceCanvas.height = sliceHPx;
              const ctx = sliceCanvas.getContext('2d')!;
              ctx.drawImage(canvas, 0, srcY, canvas.width, sliceHPx, 0, 0, canvas.width, sliceHPx);

              const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.8);
              const sliceImgH = (sliceHPx * contentW) / canvas.width;
              pdf.addImage(sliceData, 'JPEG', margin, cursorY, imgW, sliceImgH);

              srcY += sliceHPx;
              cursorY += sliceImgH + 4;

              // If there's more to draw, start a new page
              if (srcY < canvas.height) {
                addPageNumber();
                pdf.addPage();
                pageNum++;
                cursorY = margin;
              }
            }
            cursorY += 4; // extra spacing after a multi-page element
          }
        } finally {
          restore();
        }
      };

      // Title header
      pdf.setFontSize(20);
      pdf.setTextColor(30, 41, 59);
      pdf.text('Game Results', margin, cursorY + 7);
      cursorY += 12;
      pdf.setFontSize(12);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`${session?.name || ''} — Code: ${session?.code || ''}`, margin, cursorY + 4);
      cursorY += 12;

      // Capture leaderboard in chunks that fit on pages
      const leaderboard = resultsRef.current.querySelector('.leaderboard') as HTMLElement;
      if (leaderboard) {
        const tableHeader = leaderboard.querySelector('.table-header') as HTMLElement;
        const tableRows = Array.from(leaderboard.querySelectorAll('.table-row')) as HTMLElement[];
        const sectionTitle = leaderboard.querySelector('h2') as HTMLElement;
        const exportWrapper = resultsRef.current.closest('.game-results') as HTMLElement;
        const ROWS_PER_CHUNK = 20;

        for (let idx = 0; idx < tableRows.length; idx += ROWS_PER_CHUNK) {
          const isFirst = idx === 0;
          const batch = tableRows.slice(idx, idx + ROWS_PER_CHUNK);

          // Build a temporary container inside the .game-results.exporting
          // wrapper so all export CSS overrides (e.g. .player-name) apply
          const container = document.createElement('div');
          container.className = 'results-section leaderboard';
          container.style.position = 'absolute';
          container.style.left = '-9999px';
          container.style.top = '0';
          container.style.width = `${leaderboard.offsetWidth}px`;

          if (isFirst && sectionTitle) {
            container.appendChild(sectionTitle.cloneNode(true));
          }

          const table = document.createElement('div');
          table.className = 'leaderboard-table';
          table.appendChild(tableHeader.cloneNode(true));
          for (const row of batch) {
            table.appendChild(row.cloneNode(true));
          }
          container.appendChild(table);
          exportWrapper.appendChild(container);

          try {
            await captureAndAdd(container);
          } finally {
            exportWrapper.removeChild(container);
          }
        }
      }

      // Capture each chart card individually
      const chartCards = Array.from(resultsRef.current.querySelectorAll('.chart-card')) as HTMLElement[];
      for (const card of chartCards) {
        await captureAndAdd(card);
      }

      addPageNumber();
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

  const costRevenueChartData = results.map(r => {
    const params = session!.parameters;
    return {
      name: r.playerName,
      'Staffing Cost': r.staffingCost,
      'Waiting Cost': r.waitingCosts,
      'Risk Event Cost': r.riskEventCosts,
      'Revenue (Type A)': r.patientsTreated.A * params.revenuePerPatient.A,
      'Revenue (Type B)': r.patientsTreated.B * params.revenuePerPatient.B,
      'Revenue (Type C)': r.patientsTreated.C * params.revenuePerPatient.C,
    };
  });

  return (
    <div className={`game-results${isExporting ? ' exporting' : ''}`}>
      <header className="results-header">
        <div className="header-left">
          {!effectivePlayerId && (
            <Button variant="secondary" size="small" onClick={() => navigate('/instructor/dashboard')}>
              &larr; Back
            </Button>
          )}
          <h1>Game Results</h1>
          <span className="session-name">{session.name}</span>
        </div>
        <div className="header-actions">
          {!effectivePlayerId ? (
            <>
              <Button variant="secondary" onClick={handleDownloadExcel} loading={isExportingExcel}>
                Download Excel
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
                className={`table-row ${effectivePlayerId === result.playerId ? 'highlight' : ''} ${index < 3 ? `rank-${index + 1}` : ''}`}
              >
                <span className="player-name">
                  <span className="rank">{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}</span>
                  {result.playerName}
                  {session?.asyncMode && result.hoursCompleted < 24 && (
                    <span className="in-progress-badge">({result.hoursCompleted}/24 hrs)</span>
                  )}
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
              <ComposedChart margin={{ top: 10, right: 20, bottom: 40, left: 30 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" name="Utilization" unit="%" domain={['auto', 'auto']} label={{ value: 'Utilization (%)', position: 'insideBottomRight', offset: -5, style: { fontSize: 11, fill: '#64748b' } }} />
                <YAxis type="number" dataKey="y" name="Queue Length" domain={['auto', 'auto']} label={{ value: 'Avg Queue Length', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11, fill: '#64748b', textAnchor: 'middle' } }} />
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
              <ComposedChart margin={{ top: 10, right: 20, bottom: 40, left: 30 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" name="Utilization" unit="%" domain={['auto', 'auto']} label={{ value: 'Utilization (%)', position: 'insideBottomRight', offset: -5, style: { fontSize: 11, fill: '#64748b' } }} />
                <YAxis type="number" dataKey="y" name="Profit" domain={['auto', 'auto']} tickFormatter={formatCompact} label={{ value: 'Profit', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11, fill: '#64748b', textAnchor: 'middle' } }} />
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
              <ComposedChart margin={{ top: 10, right: 20, bottom: 40, left: 30 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" name="Mismatch" unit="%" domain={['auto', 'auto']} label={{ value: 'Mismatch (%)', position: 'insideBottomRight', offset: -5, style: { fontSize: 11, fill: '#64748b' } }} />
                <YAxis type="number" dataKey="y" name="Profit" domain={['auto', 'auto']} tickFormatter={formatCompact} label={{ value: 'Profit', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11, fill: '#64748b', textAnchor: 'middle' } }} />
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
              <ComposedChart margin={{ top: 10, right: 20, bottom: 40, left: 30 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" name="Staffing Cost" domain={['auto', 'auto']} tickFormatter={formatCompact} label={{ value: 'Staffing Cost', position: 'insideBottomRight', offset: -5, style: { fontSize: 11, fill: '#64748b' } }} />
                <YAxis type="number" dataKey="y" name="Wait Cost" domain={['auto', 'auto']} tickFormatter={formatCompact} label={{ value: 'Wait Cost', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11, fill: '#64748b', textAnchor: 'middle' } }} />
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
                margin={{ top: 20, right: 30, left: 20, bottom: 35 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} label={{ value: 'Number of Rooms', position: 'insideBottom', offset: -5, style: { fontSize: 12, fill: '#64748b' } }} />
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
                margin={{ top: 20, right: 30, left: 20, bottom: 35 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} label={{ value: 'Number of Events', position: 'insideBottom', offset: -5, style: { fontSize: 12, fill: '#64748b' } }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Type A (Cardiac Arrest)" stackId="events" fill="#dc2626" />
                <Bar dataKey="Type B (LWBS)" stackId="events" fill="#eab308" />
                <Bar dataKey="Type C (LWBS)" stackId="events" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Cost & Revenue Breakdown (ordered by profit) */}
          <div className="chart-card wide">
            <h3>Cost & Revenue Breakdown (Ordered by Profit)</h3>
            <ResponsiveContainer width="100%" height={Math.max(150, costRevenueChartData.length * 50 + 60)}>
              <BarChart
                data={costRevenueChartData}
                layout="vertical"
                margin={{ top: 20, right: 30, left: 20, bottom: 35 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v: number) => formatCurrency(v)} label={{ value: 'Amount ($)', position: 'insideBottom', offset: -5, style: { fontSize: 12, fill: '#64748b' } }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="Staffing Cost" stackId="cost" fill="#475569" />
                <Bar dataKey="Waiting Cost" stackId="cost" fill="#f59e0b" />
                <Bar dataKey="Risk Event Cost" stackId="cost" fill="#dc2626" />
                <Bar dataKey="Revenue (Type A)" stackId="revenue" fill="#ef4444" />
                <Bar dataKey="Revenue (Type B)" stackId="revenue" fill="#eab308" />
                <Bar dataKey="Revenue (Type C)" stackId="revenue" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

