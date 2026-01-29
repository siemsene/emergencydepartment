import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { Input } from '../shared/Input';
import { Button } from '../shared/Button';
import './InstructorAuth.css';

type AuthMode = 'login' | 'register' | 'forgot';

export function InstructorAuth() {
  const navigate = useNavigate();
  const { login, register, resetUserPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      navigate('/instructor/dashboard');
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      await register(email, password, name, organization);
      setSuccess('Registration successful! Please wait for admin approval.');
      setMode('login');
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(err.message || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await resetUserPassword(email);
      setSuccess('Password reset email sent. Check your inbox.');
      setMode('login');
    } catch (err: any) {
      console.error('Password reset error:', err);
      setError(err.message || 'Failed to send reset email');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="instructor-auth-page">
      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="logo-section">
          <h1 className="game-title">EMERGENCY!</h1>
          <p className="game-subtitle">Instructor Portal</p>
        </div>

        <AnimatePresence mode="wait">
          {mode === 'login' && (
            <motion.form
              key="login"
              onSubmit={handleLogin}
              className="auth-form"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <h2>Sign In</h2>

              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />

              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
              />

              {error && <div className="error-message">{error}</div>}
              {success && <div className="success-message">{success}</div>}

              <Button type="submit" variant="primary" size="large" loading={isLoading}>
                Sign In
              </Button>

              <div className="auth-links">
                <button type="button" onClick={() => setMode('forgot')}>
                  Forgot password?
                </button>
                <button type="button" onClick={() => setMode('register')}>
                  Create an account
                </button>
              </div>
            </motion.form>
          )}

          {mode === 'register' && (
            <motion.form
              key="register"
              onSubmit={handleRegister}
              className="auth-form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <h2>Create Account</h2>

              <Input
                label="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                required
              />

              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />

              <Input
                label="Organization (optional)"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="University or Company"
              />

              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                required
              />

              <Input
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
              />

              {error && <div className="error-message">{error}</div>}

              <Button type="submit" variant="primary" size="large" loading={isLoading}>
                Register
              </Button>

              <p className="approval-note">
                Note: Your account will require admin approval before you can access the dashboard.
              </p>

              <div className="auth-links">
                <button type="button" onClick={() => setMode('login')}>
                  Already have an account? Sign in
                </button>
              </div>
            </motion.form>
          )}

          {mode === 'forgot' && (
            <motion.form
              key="forgot"
              onSubmit={handleForgotPassword}
              className="auth-form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <h2>Reset Password</h2>

              <p className="forgot-text">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />

              {error && <div className="error-message">{error}</div>}
              {success && <div className="success-message">{success}</div>}

              <Button type="submit" variant="primary" size="large" loading={isLoading}>
                Send Reset Link
              </Button>

              <div className="auth-links">
                <button type="button" onClick={() => setMode('login')}>
                  Back to sign in
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="player-link">
          <span>Are you a student?</span>
          <a href="/">Join a game here</a>
        </div>
      </motion.div>
    </div>
  );
}
