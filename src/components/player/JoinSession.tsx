import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Input } from '../shared/Input';
import { Button } from '../shared/Button';
import { joinSession } from '../../services/firebaseService';
import { useGame } from '../../contexts/GameContext';
import { validatePlayerName, validateSessionCode } from '../../utils/validation';
import './JoinSession.css';

export function JoinSession() {
  const navigate = useNavigate();
  const { setSession, setPlayer } = useGame();
  const [sessionCode, setSessionCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const codeError = validateSessionCode(sessionCode);
    if (codeError) {
      setError(codeError);
      return;
    }

    const nameError = validatePlayerName(playerName);
    if (nameError) {
      setError(nameError);
      return;
    }

    setIsLoading(true);

    try {
      const { player, error: joinError } = await joinSession(sessionCode.toUpperCase().trim(), playerName.trim());

      if (!player) {
        if (joinError === 'NAME_TAKEN') {
          setError('That name is already taken in this session. Please choose a different name.');
        } else {
          setError('Invalid session code or session has expired');
        }
        setIsLoading(false);
        return;
      }

      // Store player info in localStorage for reconnection
      localStorage.setItem('playerId', player.id);
      localStorage.setItem('sessionCode', sessionCode.toUpperCase().trim());
      localStorage.setItem('playerName', playerName.trim());

      setPlayer(player);
      navigate(`/play/${player.sessionId}`);
    } catch (err: any) {
      console.error('Failed to join session:', err);
      setError('Failed to join session. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="join-session-page">
      <motion.div
        className="join-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="logo-section">
          <img src="/emerg_logo.gif" alt="EMERGENCY! The ED Simulation Game" className="game-logo" />
        </div>

        <form onSubmit={handleSubmit} className="join-form">
          <Input
            label="Session Code"
            placeholder="Enter 6-character code"
            value={sessionCode}
            onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
            maxLength={6}
            autoFocus
          />

          <Input
            label="Your Name"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />

          {error && <div className="error-message">{error}</div>}

          <Button
            type="submit"
            variant="primary"
            size="large"
            loading={isLoading}
            disabled={!sessionCode || !playerName}
          >
            Join Game
          </Button>
        </form>

        <div className="instructor-link">
          <span>Are you an instructor?</span>
          <a href="/instructor/login">Log in here</a>
        </div>
      </motion.div>
    </div>
  );
}
