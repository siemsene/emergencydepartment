import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  writeBatch,
  arrayUnion,
  runTransaction,
  limit
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { db, auth } from '../config/firebase';
import { Instructor, Session, Player, PlayerGameState, GameParameters, HourlyArrivals } from '../types';
import { generateSessionCode, initializePlayerGameState } from '../utils/gameUtils';
import { DEFAULT_PARAMETERS } from '../data/gameConstants';
import { notifyAdminNewInstructor } from './emailService';

// Auth Functions
export function subscribeToAuthChanges(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function registerInstructor(
  email: string,
  password: string,
  name: string,
  organization?: string
): Promise<string> {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const userId = userCredential.user.uid;

  const instructor: Omit<Instructor, 'id'> = {
    email,
    name,
    role: 'instructor',
    approved: false,
    organization,
    sessionsCreated: 0,
    createdAt: new Date()
  };

  await setDoc(doc(db, 'instructors', userId), {
    ...instructor,
    createdAt: serverTimestamp()
  });

  // Notify admin
  await notifyAdminNewInstructor(name, email, organization);

  return userId;
}

export async function loginUser(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logoutUser() {
  return signOut(auth);
}

export async function resetPassword(email: string) {
  return sendPasswordResetEmail(auth, email);
}

// Instructor Functions
export async function getInstructor(userId: string): Promise<Instructor | null> {
  const docRef = doc(db, 'instructors', userId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      approvedAt: data.approvedAt?.toDate(),
      lastActive: data.lastActive?.toDate()
    } as Instructor;
  }
  return null;
}

export async function getAllInstructors(): Promise<Instructor[]> {
  const querySnapshot = await getDocs(collection(db, 'instructors'));
  return querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      approvedAt: data.approvedAt?.toDate(),
      lastActive: data.lastActive?.toDate()
    } as Instructor;
  });
}

export async function approveInstructor(instructorId: string, adminId: string) {
  await updateDoc(doc(db, 'instructors', instructorId), {
    approved: true,
    approvedAt: serverTimestamp(),
    approvedBy: adminId
  });
}

export async function removeInstructorAccess(instructorId: string) {
  await updateDoc(doc(db, 'instructors', instructorId), {
    approved: false
  });
}

export async function updateInstructorActivity(instructorId: string) {
  await updateDoc(doc(db, 'instructors', instructorId), {
    lastActive: serverTimestamp()
  });
}

// Session Functions
export async function createSession(
  instructorId: string,
  name: string,
  parameters: GameParameters = DEFAULT_PARAMETERS
): Promise<Session> {
  const sessionId = doc(collection(db, 'sessions')).id;
  let code: string;

  // Ensure unique code with proper re-query inside loop
  do {
    code = generateSessionCode();
  } while (await getSessionByCode(code));

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const session: Session = {
    id: sessionId,
    code,
    instructorId,
    name,
    createdAt: new Date(),
    expiresAt,
    status: 'setup',
    currentHour: 0,
    parameters,
    arrivals: [],
    players: [],
    usePregenerated: false,
    asyncMode: false
  };

  await setDoc(doc(db, 'sessions', sessionId), {
    ...session,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt)
  });

  // Update instructor session count
  const currentSessionsCreated = (await getInstructor(instructorId))?.sessionsCreated ?? 0;
  await updateDoc(doc(db, 'instructors', instructorId), {
    sessionsCreated: currentSessionsCreated + 1,
    lastActive: serverTimestamp()
  });

  return session;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const docRef = doc(db, 'sessions', sessionId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      startedAt: data.startedAt?.toDate(),
      endedAt: data.endedAt?.toDate(),
      expiresAt: data.expiresAt?.toDate() || new Date()
    } as Session;
  }
  return null;
}

export async function getSessionByCode(code: string): Promise<Session | null> {
  const q = query(collection(db, 'sessions'), where('code', '==', code.toUpperCase()), limit(1));
  const querySnapshot = await getDocs(q);
  if (!querySnapshot.empty) {
    const doc = querySnapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      startedAt: data.startedAt?.toDate(),
      endedAt: data.endedAt?.toDate(),
      expiresAt: data.expiresAt?.toDate() || new Date()
    } as Session;
  }
  return null;
}

export async function getInstructorSessions(instructorId: string): Promise<Session[]> {
  const q = query(
    collection(db, 'sessions'),
    where('instructorId', '==', instructorId)
  );
  const querySnapshot = await getDocs(q);
  const sessions = querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      startedAt: data.startedAt?.toDate(),
      endedAt: data.endedAt?.toDate(),
      expiresAt: data.expiresAt?.toDate() || new Date()
    } as Session;
  });
  sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return sessions;
}

export async function updateSessionParameters(sessionId: string, parameters: GameParameters) {
  await updateDoc(doc(db, 'sessions', sessionId), { parameters });
}

export async function updateSessionArrivals(sessionId: string, arrivals: HourlyArrivals[], usePregenerated: boolean) {
  await updateDoc(doc(db, 'sessions', sessionId), { arrivals, usePregenerated });
}

export async function startSession(sessionId: string, asyncMode?: boolean) {
  if (asyncMode) {
    // In async mode, skip the session-level staffing phase and go directly to sequencing.
    // Players will still see staffing UI based on their own staffingComplete flag.
    await updateDoc(doc(db, 'sessions', sessionId), {
      status: 'sequencing',
      currentHour: 1,
      asyncMode: true,
      startedAt: serverTimestamp()
    });
  } else {
    await updateDoc(doc(db, 'sessions', sessionId), {
      status: 'staffing',
      startedAt: serverTimestamp()
    });
  }
}

export async function advanceSessionToSequencing(sessionId: string) {
  await updateDoc(doc(db, 'sessions', sessionId), {
    status: 'sequencing',
    currentHour: 1
  });
}

export async function advanceSessionHour(sessionId: string, newHour: number) {
  const sessionRef = doc(db, 'sessions', sessionId);

  await runTransaction(db, async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) return;

    const currentHour = sessionSnap.data().currentHour ?? 0;

    // Only advance if newHour is exactly currentHour + 1 (prevents double-advances)
    if (newHour !== currentHour + 1 && newHour <= 24) return;
    // Also allow completing (newHour > 24) only from hour 24
    if (newHour > 24 && currentHour !== 24) return;

    if (newHour > 24) {
      transaction.update(sessionRef, {
        status: 'completed',
        currentHour: 24,
        endedAt: serverTimestamp()
      });
    } else if (sessionSnap.data().pauseAfterTurn) {
      transaction.update(sessionRef, {
        status: 'paused',
        pauseAfterTurn: false
      });
    } else {
      transaction.update(sessionRef, {
        currentHour: newHour
      });
    }
  });
}

export async function endSessionEarly(sessionId: string) {
  await updateDoc(doc(db, 'sessions', sessionId), {
    status: 'completed',
    endedAt: serverTimestamp()
  });
}

export async function pauseSession(sessionId: string) {
  await updateDoc(doc(db, 'sessions', sessionId), {
    pauseAfterTurn: true
  });
}

export async function cancelPauseSession(sessionId: string) {
  await updateDoc(doc(db, 'sessions', sessionId), {
    pauseAfterTurn: false
  });
}

export async function resumeSession(sessionId: string) {
  const sessionRef = doc(db, 'sessions', sessionId);
  await runTransaction(db, async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) return;

    const currentHour = sessionSnap.data().currentHour ?? 0;
    const newHour = currentHour + 1;

    if (newHour > 24) {
      transaction.update(sessionRef, {
        status: 'completed',
        currentHour: 24,
        endedAt: serverTimestamp(),
        pauseAfterTurn: false
      });
    } else {
      transaction.update(sessionRef, {
        status: 'sequencing',
        currentHour: newHour,
        pauseAfterTurn: false
      });
    }
  });
}

export async function deleteSession(sessionId: string) {
  // Delete all players in the session first
  const playersQuery = query(collection(db, 'players'), where('sessionId', '==', sessionId));
  const playersSnapshot = await getDocs(playersQuery);

  const batch = writeBatch(db);
  playersSnapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  batch.delete(doc(db, 'sessions', sessionId));
  await batch.commit();
}

export async function deleteAllInstructorSessions(instructorId: string) {
  const sessionsQuery = query(collection(db, 'sessions'), where('instructorId', '==', instructorId));
  const sessionsSnapshot = await getDocs(sessionsQuery);

  for (const sessionDoc of sessionsSnapshot.docs) {
    await deleteSession(sessionDoc.id);
  }
}

export function subscribeToSession(sessionId: string, callback: (session: Session | null) => void) {
  return onSnapshot(doc(db, 'sessions', sessionId), (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      callback({
        id: docSnap.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        startedAt: data.startedAt?.toDate(),
        endedAt: data.endedAt?.toDate(),
        expiresAt: data.expiresAt?.toDate() || new Date()
      } as Session);
    } else {
      callback(null);
    }
  });
}

type JoinSessionResult = { player: Player; error?: undefined } | { player: null; error: string };

// Player Functions
export async function joinSession(sessionCode: string, playerName: string): Promise<JoinSessionResult> {
  const normalizedCode = sessionCode.toUpperCase();
  const session = (await getSessionByCode(normalizedCode)) || (await getSession(sessionCode));
  if (!session) return { player: null, error: 'SESSION_INVALID' };

  // Check if player already exists in session
  const existingPlayer = await getPlayerByNameInSession(session.id, playerName);
  if (existingPlayer) {
    // Block duplicate joins during setup; allow reconnection once game is underway
    if (session.status === 'setup') {
      return { player: null, error: 'NAME_TAKEN' };
    }
    // Reconnect
    await updateDoc(doc(db, 'players', existingPlayer.id), {
      isConnected: true,
      lastSeen: serverTimestamp()
    });
    return { player: { ...existingPlayer, isConnected: true, lastSeen: new Date() } };
  }

  // Block new joins only if the session has ended or is expired
  if (session.status === 'completed' || new Date() > session.expiresAt) return { player: null, error: 'SESSION_INVALID' };

  // Enforce player cap (default 100)
  const maxPlayers = 100;
  if (session.players.length >= maxPlayers) return { player: null, error: 'SESSION_INVALID' };

  // Create new player
  const playerId = doc(collection(db, 'players')).id;
  const player: Player = {
    id: playerId,
    name: playerName,
    sessionId: session.id,
    joinedAt: new Date(),
    isConnected: true,
    lastSeen: new Date(),
    gameState: initializePlayerGameState()
  };

  // Atomic: create player doc and update session's players array in one batch
  const batch = writeBatch(db);
  batch.set(doc(db, 'players', playerId), {
    ...player,
    joinedAt: serverTimestamp(),
    lastSeen: serverTimestamp()
  });
  batch.update(doc(db, 'sessions', session.id), {
    players: arrayUnion(playerId)
  });
  await batch.commit();

  return { player };
}

export async function getPlayerByNameInSession(sessionId: string, name: string): Promise<Player | null> {
  const q = query(
    collection(db, 'players'),
    where('sessionId', '==', sessionId),
    where('name', '==', name),
    limit(1)
  );
  const querySnapshot = await getDocs(q);
  if (!querySnapshot.empty) {
    const doc = querySnapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      joinedAt: data.joinedAt?.toDate() || new Date(),
      lastSeen: data.lastSeen?.toDate() || new Date()
    } as Player;
  }
  return null;
}

export async function getPlayer(playerId: string): Promise<Player | null> {
  const docRef = doc(db, 'players', playerId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      joinedAt: data.joinedAt?.toDate() || new Date(),
      lastSeen: data.lastSeen?.toDate() || new Date()
    } as Player;
  }
  return null;
}

export async function getSessionPlayers(sessionId: string): Promise<Player[]> {
  const q = query(collection(db, 'players'), where('sessionId', '==', sessionId));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      joinedAt: data.joinedAt?.toDate() || new Date(),
      lastSeen: data.lastSeen?.toDate() || new Date()
    } as Player;
  });
}

export async function updatePlayerGameState(playerId: string, gameState: PlayerGameState) {
  await updateDoc(doc(db, 'players', playerId), {
    gameState,
    lastSeen: serverTimestamp()
  });
}

export async function updatePlayerGameStateFields(
  playerId: string,
  fields: Partial<PlayerGameState>
) {
  const updates: Record<string, unknown> = {};
  Object.entries(fields).forEach(([key, value]) => {
    updates[`gameState.${key}`] = value;
  });

  await updateDoc(doc(db, 'players', playerId), {
    ...updates,
    lastSeen: serverTimestamp()
  });
}

export async function updatePlayerConnection(playerId: string, isConnected: boolean) {
  await updateDoc(doc(db, 'players', playerId), {
    isConnected,
    lastSeen: serverTimestamp()
  });
}

export async function nudgePlayer(playerId: string) {
  await updateDoc(doc(db, 'players', playerId), {
    nudgedAt: Date.now()
  });
}

export async function kickPlayer(playerId: string) {
  const player = await getPlayer(playerId);
  if (player) {
    // Remove from session's player list
    const session = await getSession(player.sessionId);
    if (session) {
      await updateDoc(doc(db, 'sessions', session.id), {
        players: session.players.filter(id => id !== playerId)
      });
    }
    // Delete player document
    await deleteDoc(doc(db, 'players', playerId));
  }
}

export function subscribeToPlayer(playerId: string, callback: (player: Player | null) => void) {
  return onSnapshot(doc(db, 'players', playerId), (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      callback({
        id: docSnap.id,
        ...data,
        joinedAt: data.joinedAt?.toDate() || new Date(),
        lastSeen: data.lastSeen?.toDate() || new Date()
      } as Player);
    } else {
      callback(null);
    }
  });
}

export function subscribeToSessionPlayers(sessionId: string, callback: (players: Player[]) => void) {
  const q = query(collection(db, 'players'), where('sessionId', '==', sessionId));
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = onSnapshot(q, (querySnapshot) => {
    const players = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        joinedAt: data.joinedAt?.toDate() || new Date(),
        lastSeen: data.lastSeen?.toDate() || new Date()
      } as Player;
    });

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => callback(players), 300);
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribe();
  };
}

// Admin check (simple check by email)
export async function isAdmin(userId: string): Promise<boolean> {
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
  if (!adminEmail) return false;

  const instructor = await getInstructor(userId);
  return instructor?.email === adminEmail;
}

// Create instructor document for admin on first login
// This handles the case where admin was created directly in Firebase Auth console
export async function createAdminInstructor(
  userId: string,
  email: string,
  name: string
): Promise<Instructor> {
  const instructor: Omit<Instructor, 'id'> = {
    email,
    name,
    role: 'instructor',
    approved: true, // Admin is auto-approved
    sessionsCreated: 0,
    createdAt: new Date()
  };

  await setDoc(doc(db, 'instructors', userId), {
    ...instructor,
    createdAt: serverTimestamp(),
    approvedAt: serverTimestamp()
  });

  return {
    id: userId,
    ...instructor
  };
}
