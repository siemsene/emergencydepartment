import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GameProvider } from './contexts/GameContext';

// Player Components
import { JoinSession } from './components/player/JoinSession';
import { PlayerGame } from './components/player/PlayerGame';

// Shared Components
import { ErrorBoundary } from './components/shared/ErrorBoundary';

import './App.css';

const InstructorAuth = lazy(() =>
  import('./components/instructor/InstructorAuth').then((module) => ({ default: module.InstructorAuth }))
);
const InstructorDashboard = lazy(() =>
  import('./components/instructor/InstructorDashboard').then((module) => ({ default: module.InstructorDashboard }))
);
const SessionSetup = lazy(() =>
  import('./components/instructor/SessionSetup').then((module) => ({ default: module.SessionSetup }))
);
const SessionMonitor = lazy(() =>
  import('./components/instructor/SessionMonitor').then((module) => ({ default: module.SessionMonitor }))
);
const AdminDashboard = lazy(() =>
  import('./components/admin/AdminDashboard').then((module) => ({ default: module.AdminDashboard }))
);
const GameResults = lazy(() =>
  import('./components/analytics/GameResults').then((module) => ({ default: module.GameResults }))
);

function RouteLoadingFallback() {
  return <div className="loading-screen">Loading...</div>;
}

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
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        {/* Player Routes */}
        <Route path="/" element={<JoinSession />} />
        <Route path="/play/:sessionId" element={<PlayerGame />} />
        <Route path="/play/:sessionId/results/:playerId" element={<GameResults />} />

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
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <GameProvider>
            <AppRoutes />
          </GameProvider>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
