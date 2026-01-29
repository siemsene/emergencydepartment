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
  return (
    <svg viewBox="0 0 40 40" className="d20-svg">
      {/* Icosahedron-style triangular face */}
      <polygon
        points="20,2 38,30 2,30"
        fill="#1e293b"
        stroke="#475569"
        strokeWidth="1"
      />
      <polygon
        points="20,2 38,30 20,38"
        fill="#334155"
        stroke="#475569"
        strokeWidth="1"
      />
      <polygon
        points="20,2 2,30 20,38"
        fill="#475569"
        stroke="#64748b"
        strokeWidth="1"
      />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        fill="white"
        fontSize="12"
        fontWeight="bold"
        className={isRolling ? 'dice-number rolling' : 'dice-number'}
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
