import React from 'react';
import { motion } from 'framer-motion';
import { Patient, PatientType } from '../../types';
import { PATIENT_COLORS } from '../../data/gameConstants';
import './PatientChip.css';

interface PatientChipProps {
  patient: Patient;
  isDragging?: boolean;
  showDice?: boolean;
  diceValue?: number;
  isRolling?: boolean;
  onClick?: () => void;
  size?: 'small' | 'medium' | 'large';
  isMovable?: boolean;
}

export function PatientChip({
  patient,
  isDragging = false,
  showDice = false,
  diceValue,
  isRolling = false,
  onClick,
  size = 'medium',
  isMovable = false
}: PatientChipProps) {
  const color = PATIENT_COLORS[patient.type];

  return (
    <motion.div
      className={`patient-chip patient-chip-${size} ${isDragging ? 'dragging' : ''} ${isMovable ? 'patient-chip-movable' : ''}`}
      style={{ borderColor: color }}
      onClick={onClick}
      whileHover={onClick ? { scale: 1.05 } : undefined}
      whileTap={onClick ? { scale: 0.95 } : undefined}
      layout
    >
      <div className="patient-chip-inner" style={{ backgroundColor: `${color}20` }}>
        <span className="patient-type" style={{ color }}>{patient.type}</span>
        {patient.waitingTime > 0 && (
          <span className="waiting-badge">{patient.waitingTime}h</span>
        )}
      </div>

      {showDice && (
        <div className={`dice-indicator ${isRolling ? 'rolling' : ''}`}>
          <D20Face value={diceValue} isRolling={isRolling} />
        </div>
      )}
    </motion.div>
  );
}

interface D20FaceProps {
  value?: number;
  isRolling?: boolean;
}

function D20Face({ value, isRolling }: D20FaceProps) {
  // Determine if this is a risk event roll (for highlighting)
  const isHighRoll = value && value >= 18;

  // Colors based on whether it's a high (dangerous) roll
  const mainColor = isHighRoll ? '#991b1b' : '#1e293b';
  const lightColor = isHighRoll ? '#b91c1c' : '#334155';
  const darkColor = isHighRoll ? '#7f1d1d' : '#0f172a';
  const strokeColor = isHighRoll ? '#ef4444' : '#64748b';
  const textColor = isHighRoll ? '#fecaca' : '#f8fafc';

  return (
    <svg viewBox="0 0 40 40" className="d20-svg">
      {/* D20 icosahedron - viewed from a vertex showing triangular faces */}

      {/* Outer hexagonal border hint */}
      <polygon
        points="20,1 37,11 37,29 20,39 3,29 3,11"
        fill="none"
        stroke={strokeColor}
        strokeWidth="0.5"
        opacity="0.3"
      />

      {/* Top-left triangular face */}
      <polygon
        points="20,1 3,11 12,20"
        fill={lightColor}
        stroke={strokeColor}
        strokeWidth="0.5"
      />

      {/* Top-right triangular face */}
      <polygon
        points="20,1 37,11 28,20"
        fill={darkColor}
        stroke={strokeColor}
        strokeWidth="0.5"
      />

      {/* Center top face (main face with number) */}
      <polygon
        points="20,1 12,20 28,20"
        fill={mainColor}
        stroke={strokeColor}
        strokeWidth="1"
      />

      {/* Left triangular face */}
      <polygon
        points="3,11 3,29 12,20"
        fill={darkColor}
        stroke={strokeColor}
        strokeWidth="0.5"
      />

      {/* Right triangular face */}
      <polygon
        points="37,11 37,29 28,20"
        fill={lightColor}
        stroke={strokeColor}
        strokeWidth="0.5"
      />

      {/* Bottom-left triangular face */}
      <polygon
        points="3,29 20,39 12,20"
        fill={lightColor}
        stroke={strokeColor}
        strokeWidth="0.5"
      />

      {/* Bottom-right triangular face */}
      <polygon
        points="37,29 20,39 28,20"
        fill={darkColor}
        stroke={strokeColor}
        strokeWidth="0.5"
      />

      {/* Center bottom face */}
      <polygon
        points="12,20 28,20 20,39"
        fill={mainColor}
        stroke={strokeColor}
        strokeWidth="0.5"
        opacity="0.7"
      />

      {/* Number display on main face */}
      <text
        x="20"
        y="15"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={textColor}
        fontSize="11"
        fontWeight="bold"
        className={isRolling ? 'dice-number rolling' : 'dice-number'}
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
      >
        {value || '?'}
      </text>
    </svg>
  );
}

// Draggable version for drag and drop
interface DraggablePatientChipProps extends PatientChipProps {
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function DraggablePatientChip({
  patient,
  onDragStart,
  onDragEnd,
  ...props
}: DraggablePatientChipProps) {
  return (
    <motion.div
      drag
      dragSnapToOrigin
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.1, zIndex: 100 }}
    >
      <PatientChip patient={patient} {...props} />
    </motion.div>
  );
}
