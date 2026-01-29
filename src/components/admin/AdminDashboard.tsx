import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { Instructor } from '../../types';
import {
  getAllInstructors,
  approveInstructor,
  removeInstructorAccess
} from '../../services/firebaseService';
import { notifyInstructorApproved, notifyInstructorRejected } from '../../services/emailService';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import './AdminDashboard.css';

export function AdminDashboard() {
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();

  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionInstructorId, setActionInstructorId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'remove' | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/instructor/login');
      return;
    }

    loadInstructors();
  }, [isAdmin, navigate]);

  const loadInstructors = async () => {
    try {
      const data = await getAllInstructors();
      setInstructors(data);
    } catch (err) {
      console.error('Error loading instructors:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!actionInstructorId || !user) return;

    try {
      await approveInstructor(actionInstructorId, user.uid);
      const instructor = instructors.find(i => i.id === actionInstructorId);
      if (instructor) {
        await notifyInstructorApproved(instructor.email, instructor.name);
      }
      await loadInstructors();
    } catch (err) {
      console.error('Error approving instructor:', err);
    } finally {
      setActionInstructorId(null);
      setActionType(null);
    }
  };

  const handleRemoveAccess = async () => {
    if (!actionInstructorId) return;

    try {
      await removeInstructorAccess(actionInstructorId);
      const instructor = instructors.find(i => i.id === actionInstructorId);
      if (instructor) {
        await notifyInstructorRejected(instructor.email, instructor.name);
      }
      await loadInstructors();
    } catch (err) {
      console.error('Error removing access:', err);
    } finally {
      setActionInstructorId(null);
      setActionType(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/instructor/login');
  };

  const pendingInstructors = instructors.filter(i => !i.approved);
  const approvedInstructors = instructors.filter(i => i.approved);

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <div className="header-left">
          <h1 className="admin-title">EMERGENCY!</h1>
          <span className="admin-subtitle">Admin Dashboard</span>
        </div>
        <div className="header-right">
          <Button variant="secondary" size="small" onClick={() => navigate('/instructor/dashboard')}>
            Instructor View
          </Button>
          <Button variant="secondary" size="small" onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </header>

      <main className="admin-main">
        {/* Pending Approvals */}
        <section className="admin-section">
          <h2>Pending Approvals ({pendingInstructors.length})</h2>
          {isLoading ? (
            <div className="loading-state">Loading...</div>
          ) : pendingInstructors.length === 0 ? (
            <div className="empty-state">No pending approvals</div>
          ) : (
            <div className="instructor-grid">
              <AnimatePresence>
                {pendingInstructors.map((instructor) => (
                  <motion.div
                    key={instructor.id}
                    className="instructor-card pending"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                  >
                    <div className="card-header">
                      <h3>{instructor.name}</h3>
                      <span className="status-badge pending">Pending</span>
                    </div>
                    <div className="card-body">
                      <p className="email">{instructor.email}</p>
                      {instructor.organization && (
                        <p className="organization">{instructor.organization}</p>
                      )}
                      <p className="date">
                        Applied: {instructor.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="card-actions">
                      <Button
                        variant="success"
                        size="small"
                        onClick={() => {
                          setActionInstructorId(instructor.id);
                          setActionType('approve');
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        size="small"
                        onClick={() => {
                          setActionInstructorId(instructor.id);
                          setActionType('remove');
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* Approved Instructors */}
        <section className="admin-section">
          <h2>Active Instructors ({approvedInstructors.length})</h2>
          {approvedInstructors.length === 0 ? (
            <div className="empty-state">No active instructors</div>
          ) : (
            <div className="instructor-table">
              <div className="table-header">
                <span>Name</span>
                <span>Email</span>
                <span>Organization</span>
                <span>Sessions</span>
                <span>Last Active</span>
                <span>Actions</span>
              </div>
              <AnimatePresence>
                {approvedInstructors.map((instructor) => (
                  <motion.div
                    key={instructor.id}
                    className="table-row"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="name">{instructor.name}</span>
                    <span className="email">{instructor.email}</span>
                    <span>{instructor.organization || '-'}</span>
                    <span>{instructor.sessionsCreated}</span>
                    <span>
                      {instructor.lastActive
                        ? instructor.lastActive.toLocaleDateString()
                        : 'Never'}
                    </span>
                    <div className="actions">
                      <Button
                        variant="danger"
                        size="small"
                        onClick={() => {
                          setActionInstructorId(instructor.id);
                          setActionType('remove');
                        }}
                      >
                        Remove Access
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      </main>

      {/* Approve Modal */}
      <Modal
        isOpen={actionType === 'approve'}
        onClose={() => {
          setActionInstructorId(null);
          setActionType(null);
        }}
        title="Approve Instructor?"
      >
        <p>This will grant instructor access and send an approval notification email.</p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setActionType(null)}>
            Cancel
          </Button>
          <Button variant="success" onClick={handleApprove}>
            Approve
          </Button>
        </div>
      </Modal>

      {/* Remove Access Modal */}
      <Modal
        isOpen={actionType === 'remove'}
        onClose={() => {
          setActionInstructorId(null);
          setActionType(null);
        }}
        title="Remove Instructor Access?"
        variant="danger"
      >
        <p>This will revoke the instructor's access to the platform.</p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setActionType(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleRemoveAccess}>
            Remove Access
          </Button>
        </div>
      </Modal>
    </div>
  );
}
