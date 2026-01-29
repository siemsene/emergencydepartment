import React from 'react';
import { motion } from 'framer-motion';
import { Room, RoomType, Patient } from '../../types';
import { ROOM_COLORS, ROOM_TYPE_NAMES, ROOM_COMPATIBILITY, PATIENT_COLORS, DEFAULT_PARAMETERS } from '../../data/gameConstants';
import { PatientChip } from './PatientChip';
import { formatCurrency } from '../../utils/gameUtils';
import './RoomCard.css';

interface RoomCardProps {
  room: Room;
  isHighlighted?: boolean;
  highlightedSlot?: number;
  isGreyedOut?: boolean;
  isPatientMovable?: boolean;
  onPatientDrop?: (roomId: string, slotIndex: number) => void;
  onPatientRemove?: (patientId: string) => void;
  showCost?: boolean;
}

export function RoomCard({
  room,
  isHighlighted = false,
  highlightedSlot,
  isGreyedOut = false,
  isPatientMovable = false,
  onPatientDrop,
  onPatientRemove,
  showCost = false
}: RoomCardProps) {
  const color = ROOM_COLORS[room.type];
  const slots = getSlotCount(room.type);
  const roomName = ROOM_TYPE_NAMES[room.type];
  const cost = DEFAULT_PARAMETERS.roomCosts[room.type];

  return (
    <motion.div
      className={`room-card ${isGreyedOut ? 'greyed-out' : ''} ${isHighlighted ? 'highlighted' : ''}`}
      style={{ borderColor: color }}
      layout
    >
      <div className="room-header" style={{ backgroundColor: color }}>
        <span className="room-name">{roomName}</span>
        {showCost && (
          <span className="room-cost">{formatCurrency(cost)}</span>
        )}
      </div>

      <div className="room-body">
        <div className="room-label">Patient Progression</div>
        <div className="room-slots">
          {Array.from({ length: slots }, (_, i) => {
            const slotNumber = slots - i;
            const isOccupied = room.patient && room.patient.treatmentProgress === slotNumber;
            const isSlotHighlighted = highlightedSlot === slotNumber;

            return (
              <div
                key={i}
                className={`room-slot ${isSlotHighlighted ? 'slot-highlighted' : ''} ${isOccupied ? 'occupied' : ''}`}
                onClick={() => !room.isOccupied && onPatientDrop?.(room.id, slotNumber)}
              >
                <span className="slot-number">{slotNumber}</span>
                {isOccupied && room.patient && (
                  <div className="slot-patient" onClick={() => onPatientRemove?.(room.patient!.id)}>
                    <PatientChip patient={room.patient} size="small" isMovable={isPatientMovable} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="room-footer">
          <span className="emergency-label" style={{ color }}>EMERGENCY!</span>
          <div className="room-capability-dots" aria-label="Supported patient types">
            {ROOM_COMPATIBILITY[room.type].map((type) => (
              <span
                key={type}
                className="capability-dot"
                style={{ backgroundColor: PATIENT_COLORS[type as keyof typeof PATIENT_COLORS] }}
                title={`Type ${type}`}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function getSlotCount(type: RoomType): number {
  switch (type) {
    case 'high': return 4;
    case 'medium': return 3;
    case 'low': return 2;
  }
}

// Inventory card for staffing phase
interface RoomInventoryCardProps {
  type: RoomType;
  count?: number;
  cost?: number;
  disabled?: boolean;
  onClick?: () => void;
  onAdd?: () => void;
}

export function RoomInventoryCard({
  type,
  count,
  cost: overrideCost,
  disabled = false,
  onClick,
  onAdd
}: RoomInventoryCardProps) {
  const color = ROOM_COLORS[type];
  const name = ROOM_TYPE_NAMES[type];
  const cost = overrideCost ?? DEFAULT_PARAMETERS.roomCosts[type];
  const slots = getSlotCount(type);
  const handleClick = disabled ? undefined : (onAdd ?? onClick);

  return (
    <motion.div
      className="room-inventory-card"
      style={{ borderColor: color }}
      onClick={handleClick}
      whileHover={handleClick ? { scale: 1.02 } : undefined}
      whileTap={handleClick ? { scale: 0.98 } : undefined}
    >
      <div className="inventory-header" style={{ backgroundColor: color }}>
        <span>{name}</span>
      </div>
      <div className="inventory-body">
        <div className="inventory-slots">
          {Array.from({ length: slots }, (_, i) => (
            <div key={i} className="inventory-slot">
              {slots - i}
            </div>
          ))}
        </div>
        <div className="inventory-cost">{formatCurrency(cost)}/day</div>
      </div>
      {count !== undefined && (
        <div className="inventory-count">{count}</div>
      )}
    </motion.div>
  );
}

// Empty room slot on the board
interface EmptyRoomSlotProps {
  position: number;
  isHighlighted?: boolean;
  onDrop?: () => void;
}

export function EmptyRoomSlot({ position, isHighlighted, onDrop }: EmptyRoomSlotProps) {
  return (
    <motion.div
      className={`empty-room-slot ${isHighlighted ? 'highlighted' : ''}`}
      onClick={onDrop}
      whileHover={{ backgroundColor: '#f1f5f9' }}
    >
      <span className="slot-label">Exam Room {position + 1}</span>
    </motion.div>
  );
}
