import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GameProvider } from './contexts/GameContext';

// Player Components
import { JoinSession } from './components/player/JoinSession';
import { PlayerGame } from './components/player/PlayerGame';

// Instructor Components
import { InstructorAuth } from './components/instructor/InstructorAuth';
import { InstructorDashboard } from './components/instructor/InstructorDashboard';
import { SessionSetup } from './components/instructor/SessionSetup';
import { SessionMonitor } from './components/instructor/SessionMonitor';

// Admin Components
import { AdminDashboard } from './components/admin/AdminDashboard';

// Analytics Components
import { GameResults } from './components/analytics/GameResults';

import './App.css';

// Protected Route for Instructors
function InstructorRoute({ children }: { children: React.ReactNode }) {
  const { user, instructor, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!user || !instructor) {
    return <Navigate to="/instructor/login" replace />;
  }

  return <>{children}</>;
}

// Protected Route for Admin
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!user || !isAdmin) {
    return <Navigate to="/instructor/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Player Routes */}
      <Route path="/" element={<JoinSession />} />
      <Route path="/play/:sessionId" element={<PlayerGame />} />

      {/* Instructor Routes */}
      <Route path="/instructor/login" element={<InstructorAuth />} />
      <Route
        path="/instructor/dashboard"
        element={
          <InstructorRoute>
            <InstructorDashboard />
          </InstructorRoute>
        }
      />
      <Route
        path="/instructor/session/:sessionId/setup"
        element={
          <InstructorRoute>
            <SessionSetup />
          </InstructorRoute>
        }
      />
      <Route
        path="/instructor/session/:sessionId/monitor"
        element={
          <InstructorRoute>
            <SessionMonitor />
          </InstructorRoute>
        }
      />
      <Route
        path="/instructor/session/:sessionId/results"
        element={
          <InstructorRoute>
            <GameResults />
          </InstructorRoute>
        }
      />

      {/* Admin Routes */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <GameProvider>
          <AppRoutes />
        </GameProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
