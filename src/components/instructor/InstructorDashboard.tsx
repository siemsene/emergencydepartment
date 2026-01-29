import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { Session } from '../../types';
import {
  getInstructorSessions,
  createSession,
  deleteSession,
  deleteAllInstructorSessions
} from '../../services/firebaseService';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Modal } from '../shared/Modal';
import { DEFAULT_PARAMETERS } from '../../data/gameConstants';
import './InstructorDashboard.css';

export function InstructorDashboard() {
  const navigate = useNavigate();
  const { instructor, logout, isAdmin } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  useEffect(() => {
    if (!instructor) {
      navigate('/instructor/login');
      return;
    }

    if (!instructor.approved) {
      // Show pending approval message
      return;
    }

    loadSessions();
  }, [instructor, navigate]);

  const loadSessions = async () => {
    if (!instructor?.id) return;

    try {
      const userSessions = await getInstructorSessions(instructor.id);
      setSessions(userSessions);
    } catch (err) {
      console.error('Error loading sessions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSession = async () => {
    if (!instructor?.id || !newSessionName.trim()) return;

    setIsCreating(true);
    try {
      const session = await createSession(instructor.id, newSessionName.trim(), DEFAULT_PARAMETERS);
      navigate(`/instructor/session/${session.id}/setup`);
    } catch (err) {
      console.error('Error creating session:', err);
    } finally {
      setIsCreating(false);
      setShowNewSessionModal(false);
      setNewSessionName('');
    }
  };

  const handleDeleteSession = async () => {
    if (!deleteSessionId) return;

    try {
      await deleteSession(deleteSessionId);
      setSessions(sessions.filter(s => s.id !== deleteSessionId));
    } catch (err) {
      console.error('Error deleting session:', err);
    } finally {
      setDeleteSessionId(null);
    }
  };

  const handleDeleteAllSessions = async () => {
    if (!instructor?.id) return;

    setIsDeletingAll(true);
    try {
      await deleteAllInstructorSessions(instructor.id);
      setSessions([]);
    } catch (err) {
      console.error('Error deleting all sessions:', err);
    } finally {
      setIsDeletingAll(false);
      setShowDeleteAllModal(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/instructor/login');
  };

  const getStatusBadge = (status: Session['status']) => {
    const statusConfig = {
      setup: { label: 'Setup', color: '#64748b' },
      staffing: { label: 'Staffing', color: '#f59e0b' },
      sequencing: { label: 'In Progress', color: '#22c55e' },
      completed: { label: 'Completed', color: '#3b82f6' }
    };

    const config = statusConfig[status];
    return (
      <span className="status-badge" style={{ backgroundColor: config.color }}>
        {config.label}
      </span>
    );
  };

  if (!instructor) {
    return null;
  }

  if (!instructor.approved) {
    return (
      <div className="pending-approval-page">
        <div className="pending-card">
          <h1>Account Pending Approval</h1>
          <p>Your instructor account is awaiting admin approval. You'll receive an email once your account has been approved.</p>
          <Button variant="secondary" onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="instructor-dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1 className="dashboard-title">EMERGENCY!</h1>
          <span className="dashboard-subtitle">Instructor Dashboard</span>
        </div>
        <div className="header-right">
          <span className="user-name">Welcome, {instructor.name}</span>
          {isAdmin && (
            <Button variant="secondary" size="small" onClick={() => navigate('/admin')}>
              Admin Panel
            </Button>
          )}
          <Button variant="secondary" size="small" onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="sessions-header">
          <h2>Your Sessions</h2>
          <div className="sessions-actions">
            <Button variant="primary" onClick={() => setShowNewSessionModal(true)}>
              + New Session
            </Button>
            <Button
              variant="danger"
              onClick={() => setShowDeleteAllModal(true)}
              disabled={sessions.length === 0}
            >
              Delete All
            </Button>
          </div>
        </div>
        <p className="sessions-note">
          Sessions stay available for 30 days. You can rejoin any session until you delete it.
        </p>

        {isLoading ? (
          <div className="loading-state">Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div className="empty-state">
            <h3>No sessions yet</h3>
            <p>Create your first game session to get started!</p>
            <Button variant="primary" onClick={() => setShowNewSessionModal(true)}>
              Create Session
            </Button>
          </div>
        ) : (
          <div className="sessions-grid">
            <AnimatePresence>
              {sessions.map((session) => (
                <motion.div
                  key={session.id}
                  className="session-card"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="session-card-header">
                    <h3>{session.name}</h3>
                    <div className="session-card-status">
                      <span className={`activity-pill ${session.status === 'completed' ? 'completed' : 'active'}`}>
                        {session.status === 'completed' ? 'Completed' : 'Active'}
                      </span>
                      {getStatusBadge(session.status)}
                    </div>
                  </div>

                  <div className="session-card-body">
                    <div className="session-code">
                      <span className="code-label">Session Code</span>
                      <span className="code-value">{session.code}</span>
                    </div>

                    <div className="session-info">
                      <span>Players: {session.players.length}</span>
                      {session.status === 'sequencing' && (
                        <span>Hour: {session.currentHour}/24</span>
                      )}
                    </div>

                    <div className="session-dates">
                      <span>Created: {session.createdAt.toLocaleDateString()}</span>
                      <span>Expires: {session.expiresAt.toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="session-card-actions">
                    {session.status === 'setup' && (
                      <Button
                        variant="primary"
                        size="small"
                        onClick={() => navigate(`/instructor/session/${session.id}/setup`)}
                      >
                        Configure
                      </Button>
                    )}
                    {(session.status === 'staffing' || session.status === 'sequencing') && (
                      <Button
                        variant="success"
                        size="small"
                        onClick={() => navigate(`/instructor/session/${session.id}/monitor`)}
                      >
                        Monitor
                      </Button>
                    )}
                    {session.status === 'completed' && (
                      <Button
                        variant="primary"
                        size="small"
                        onClick={() => navigate(`/instructor/session/${session.id}/results`)}
                      >
                        View Results
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => setDeleteSessionId(session.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* New Session Modal */}
      <Modal
        isOpen={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
        title="Create New Session"
      >
        <Input
          label="Session Name"
          value={newSessionName}
          onChange={(e) => setNewSessionName(e.target.value)}
          placeholder="e.g., Operations Management Class"
          autoFocus
        />
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setShowNewSessionModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreateSession}
            loading={isCreating}
            disabled={!newSessionName.trim()}
          >
            Create Session
          </Button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteSessionId}
        onClose={() => setDeleteSessionId(null)}
        title="Delete Session?"
        variant="danger"
      >
        <p>Are you sure you want to delete this session? This action cannot be undone and all player data will be lost.</p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setDeleteSessionId(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteSession}>
            Delete Session
          </Button>
        </div>
      </Modal>

      {/* Delete All Confirmation Modal */}
      <Modal
        isOpen={showDeleteAllModal}
        onClose={() => setShowDeleteAllModal(false)}
        title="Delete All Sessions?"
        variant="danger"
      >
        <p>This will permanently delete all of your sessions and all player data. This cannot be undone.</p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setShowDeleteAllModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteAllSessions} loading={isDeletingAll}>
            Delete All Sessions
          </Button>
        </div>
      </Modal>
    </div>
  );
}
