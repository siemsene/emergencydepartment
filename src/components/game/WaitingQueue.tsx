import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Patient, PatientType, GameParameters } from '../../types';
import { PatientChip } from './PatientChip';
import './WaitingQueue.css';

interface WaitingQueueProps {
  patients: Patient[];
  maxSize: number;
  selectedPatientId?: string | null;
  onPatientClick?: (patientId: string) => void;
  showDice?: boolean;
  diceResults?: Map<string, { roll: number; isEvent: boolean }>;
  isRolling?: boolean;
  riskEventRolls?: GameParameters['riskEventRolls'];
  timeSensitiveWaitingHarms?: boolean;
}

export function WaitingQueue({
  patients,
  maxSize,
  selectedPatientId,
  onPatientClick,
  showDice = false,
  diceResults,
  isRolling = false,
  riskEventRolls,
  timeSensitiveWaitingHarms = false
}: WaitingQueueProps) {
  return (
    <div className="waiting-queue">
      <div className="queue-header">
        <span className="queue-title">Waiting Room</span>
        <span className="queue-count">{patients.length}/{maxSize}</span>
      </div>

      <div className="queue-slots">
        <AnimatePresence mode="popLayout">
          {patients.map((patient, index) => {
            const diceResult = diceResults?.get(patient.id);
            const isSelected = selectedPatientId === patient.id;

            const hasRiskEvent = diceResult?.isEvent;
            const rollValue = diceResult?.roll;
            const baseRiskRolls = riskEventRolls?.[patient.type] ?? [];
            const riskRollsForType = timeSensitiveWaitingHarms && (patient.waitingTime ?? 0) > 0
              ? baseRiskRolls.flatMap((roll) => {
                const wait = Math.max(0, patient.waitingTime ?? 0);
                return Array.from({ length: wait + 1 }, (_, i) => roll - i).filter(v => v >= 1);
              })
              : baseRiskRolls;
            const isRiskRoll = rollValue !== undefined && riskRollsForType.includes(rollValue);

            return (
              <motion.div
                key={patient.id}
                className={`queue-slot filled ${isSelected ? 'selected' : ''} ${hasRiskEvent ? 'risk-event' : ''}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: hasRiskEvent ? 0.6 : 1,
                  filter: hasRiskEvent ? 'grayscale(50%)' : 'none'
                }}
                exit={{
                  scale: 0.8,
                  opacity: 0,
                  transition: { duration: hasRiskEvent ? 1.5 : 0.3 }
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                layout
              >
                <PatientChip
                  patient={patient}
                  onClick={() => onPatientClick?.(patient.id)}
                  showDice={showDice}
                  diceValue={diceResult?.roll}
                  diceIsEvent={isRiskRoll}
                  isRolling={isRolling && !diceResult?.isEvent}
                  size="medium"
                />
                {diceResult?.isEvent && (
                  <motion.div
                    className={`event-indicator ${patient.type === 'A' ? 'cardiac' : 'lwbs'}`}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    {patient.type === 'A' ? 'Cardiac Arrest!' : 'Patient Leaves without being Seen'}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Empty slots */}
        {Array.from({ length: Math.max(0, maxSize - patients.length) }, (_, i) => (
          <div key={`empty-${i}`} className="queue-slot empty">
            <span className="slot-number">{patients.length + i + 1}</span>
          </div>
        ))}
      </div>

      {patients.length === maxSize && (
        <div className="queue-full-warning">
          Queue is full! New patients will be turned away.
        </div>
      )}
    </div>
  );
}

// Arrival animation component
interface PatientArrivalProps {
  patients: Patient[];
  onComplete?: () => void;
}

export function PatientArrival({ patients, onComplete }: PatientArrivalProps) {
  return (
    <motion.div
      className="patient-arrival"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onAnimationComplete={onComplete}
    >
      <div className="arrival-header">New Patients Arriving!</div>
      <div className="arrival-patients">
        {patients.map((patient, index) => (
          <motion.div
            key={patient.id}
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: index * 0.2 }}
          >
            <PatientChip patient={patient} size="large" />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// Patient treatment complete animation
interface PatientTreatedProps {
  patient: Patient;
  onComplete?: () => void;
}

export function PatientTreated({ patient, onComplete }: PatientTreatedProps) {
  return (
    <motion.div
      className="patient-treated-bubble"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      onAnimationComplete={onComplete}
    >
      <span>Patient Treated!</span>
    </motion.div>
  );
}
