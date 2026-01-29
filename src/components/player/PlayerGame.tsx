import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useGame } from '../../contexts/GameContext';
import { GameBoard } from '../game/GameBoard';
import { GameResults } from '../analytics/GameResults';
import { getSession, getPlayer, subscribeToSession, subscribeToPlayer, updatePlayerConnection } from '../../services/firebaseService';
// Note: subscribeToPlayer is used here ONLY for kick detection.
// Player game state updates are handled by GameContext to avoid race conditions.
import './PlayerGame.css';

export function PlayerGame() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { session, setSession, player, setPlayer, setIsInstructor } = useGame();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setIsInstructor(false);
  }, [setIsInstructor]);

  // Load session and player data
  useEffect(() => {
    const loadData = async () => {
      if (!sessionId) {
        setError('No session ID provided');
        setIsLoading(false);
        return;
      }

      try {
        // Try to get player ID from localStorage
        const storedPlayerId = localStorage.getItem('playerId');

        if (storedPlayerId) {
          const playerData = await getPlayer(storedPlayerId);
          if (playerData && playerData.sessionId === sessionId) {
            setPlayer(playerData);
            await updatePlayerConnection(storedPlayerId, true);
          } else {
            // Player not found or wrong session, redirect to join
            localStorage.removeItem('playerId');
            navigate('/');
            return;
          }
        } else {
          navigate('/');
          return;
        }

        const sessionData = await getSession(sessionId);
        if (sessionData) {
          setSession(sessionData);
        } else {
          setError('Session not found');
        }
      } catch (err) {
        console.error('Error loading game:', err);
        setError('Failed to load game');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();

    // Cleanup: mark player as disconnected when leaving
    return () => {
      const playerId = localStorage.getItem('playerId');
      if (playerId) {
        updatePlayerConnection(playerId, false);
      }
    };
  }, [sessionId, navigate, setSession, setPlayer]);

  // Subscribe to session updates
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = subscribeToSession(sessionId, (updatedSession) => {
      if (updatedSession) {
        setSession(updatedSession);
      }
    });

    return () => unsubscribe();
  }, [sessionId, setSession]);

  // Note: Player updates are handled by GameContext's subscription.
  // We only need to handle the "player was kicked" case here by checking
  // if the player document was deleted.
  useEffect(() => {
    if (!player?.id) return;

    const unsubscribe = subscribeToPlayer(player.id, (updatedPlayer) => {
      if (!updatedPlayer) {
        // Player was kicked (document deleted)
        localStorage.removeItem('playerId');
        navigate('/');
      }
      // Don't call setPlayer here - GameContext handles player updates
      // with proper guards to prevent race conditions
    });

    return () => unsubscribe();
  }, [player?.id, navigate]);

  if (isLoading) {
    return (
      <div className="player-game-loading">
        <motion.div
          className="loading-spinner"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
        <span>Loading game...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="player-game-error">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/')}>Return to Home</button>
      </div>
    );
  }

  if (!session || !player) {
    return (
      <div className="player-game-error">
        <h2>Session Not Found</h2>
        <p>The game session could not be found.</p>
        <button onClick={() => navigate('/')}>Return to Home</button>
      </div>
    );
  }

  // Show waiting screen if session is still in setup
  if (session.status === 'setup') {
    return (
      <div className="waiting-screen">
        <motion.div
          className="waiting-card"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <h1 className="game-title">EMERGENCY!</h1>
          <h2>Welcome, {player.name}!</h2>
          <p>Waiting for the instructor to start the game...</p>
          <div className="session-info">
            <span>Session Code: <strong>{session.code}</strong></span>
          </div>
          <motion.div
            className="loading-dots"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <span>.</span><span>.</span><span>.</span>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  // Show results if game is completed
  if (session.status === 'completed') {
    return <GameResults sessionId={session.id} playerId={player.id} />;
  }

  // Show game board
  return (
    <div className="player-game">
      <div className="player-header">
        <div className="player-info">
          <span className="player-name">{player.name}</span>
          <span className="session-code">Session: {session.code}</span>
        </div>
      </div>
      <GameBoard />
    </div>
  );
}
