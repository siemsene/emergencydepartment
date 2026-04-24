import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  writeBatch,
  arrayUnion,
  runTransaction,
  limit,
  increment,
  DocumentReference
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { db, auth } from '../config/firebase';
import {
  Instructor,
  Session,
  Player,
  PlayerGameState,
  PlayerStats,
  GameParameters,
  HourlyArrivals
} from '../types';
import { generateSessionCode, initializePlayerGameState } from '../utils/gameUtils';
import { DEFAULT_PARAMETERS } from '../data/gameConstants';
import { notifyAdminNewInstructor } from './emailService';

const DEFAULT_MAX_PLAYERS = 150;
const functions = getFunctions(app);
const joinSessionFn = httpsCallable<JoinSessionCallableRequest, JoinSessionCallableResponse>(
  functions,
  'joinSession'
);

type ReadyPhase = 'staffing' | 'turn';

interface ReadyAdvanceResult {
  advanced: boolean;
  stale?: boolean;
  status?: Session['status'];
  currentHour?: number;
}

interface JoinSessionCallableRequest {
  sessionCode: string;
  playerName: string;
}

interface JoinSessionCallablePlayer {
  id: string;
  name: string;
  sessionId: string;
  joinedAt: string;
  isConnected: boolean;
  lastSeen: string;
  nudgedAt?: number;
  gameState?: Partial<PlayerGameState>;
}

interface JoinSessionCallableResponse {
  player: JoinSessionCallablePlayer;
  reusedExistingPlayer: boolean;
}

function normalizePlayerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getRosterLockId(name: string): string {
  const normalized = normalizePlayerName(name)
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 80);
  return normalized || 'player';
}

function mergePlayerGameState(raw: Partial<PlayerGameState> | undefined): PlayerGameState {
  const base = initializePlayerGameState();
  const incoming = raw ?? {};
  const incomingStats = (incoming.stats ?? {}) as Partial<PlayerStats>;

  return {
    ...base,
    ...incoming,
    stats: {
      ...base.stats,
      ...incomingStats,
      patientsTreated: {
        ...base.stats.patientsTreated,
        ...(incomingStats.patientsTreated ?? {})
      },
      lwbs: {
        ...base.stats.lwbs,
        ...(incomingStats.lwbs ?? {})
      },
      turnedAway: {
        ...base.stats.turnedAway,
        ...(incomingStats.turnedAway ?? {})
      },
      hourlyDemand: {
        ...base.stats.hourlyDemand,
        ...(incomingStats.hourlyDemand ?? {})
      },
      hourlyAvailableCapacity: {
        ...base.stats.hourlyAvailableCapacity,
        ...(incomingStats.hourlyAvailableCapacity ?? {})
      },
      maxWaitingTime: {
        ...base.stats.maxWaitingTime,
        ...(incomingStats.maxWaitingTime ?? {})
      }
    },
    turnEvents: {
      ...base.turnEvents,
      ...(incoming.turnEvents ?? {}),
      arrived: {
        ...base.turnEvents.arrived,
        ...(incoming.turnEvents?.arrived ?? {})
      },
      turnedAway: {
        ...base.turnEvents.turnedAway,
        ...(incoming.turnEvents?.turnedAway ?? {})
      }
    },
    lastReadyEpoch: incoming.lastReadyEpoch ?? -1
  };
}

function mapPlayerFromCallable(player: JoinSessionCallablePlayer): Player {
  return {
    ...player,
    joinedAt: new Date(player.joinedAt),
    lastSeen: new Date(player.lastSeen),
    gameState: mergePlayerGameState(player.gameState)
  };
}

function mapSessionFromSnapshot(id: string, data: Record<string, any>): Session {
  return {
    id,
    ...data,
    createdAt: data.createdAt?.toDate() || new Date(),
    startedAt: data.startedAt?.toDate(),
    endedAt: data.endedAt?.toDate(),
    expiresAt: data.expiresAt?.toDate() || new Date(),
    players: Array.isArray(data.players) ? data.players : [],
    maxPlayers: Number(data.maxPlayers ?? DEFAULT_MAX_PLAYERS),
    playerCount: Number(data.playerCount ?? (Array.isArray(data.players) ? data.players.length : 0)),
    staffingReadyCount: Number(data.staffingReadyCount ?? 0),
    turnReadyCount: Number(data.turnReadyCount ?? 0),
    syncEpoch: Number(data.syncEpoch ?? 0)
  } as Session;
}

function mapPlayerFromSnapshot(id: string, data: Record<string, any>): Player {
  return {
    id,
    ...data,
    joinedAt: data.joinedAt?.toDate() || new Date(),
    lastSeen: data.lastSeen?.toDate() || new Date(),
    gameState: mergePlayerGameState(data.gameState)
  } as Player;
}

function mapInstructorFromSnapshot(id: string, data: Record<string, any>): Instructor {
  const approvalStatus = data.approvalStatus ?? (data.approved ? 'approved' : 'pending');

  return {
    id,
    ...data,
    approvalStatus,
    createdAt: data.createdAt?.toDate() || new Date(),
    approvedAt: data.approvedAt?.toDate(),
    lastActive: data.lastActive?.toDate()
  } as Instructor;
}

async function deleteRefsInBatches(refs: DocumentReference[]): Promise<void> {
  let batch = writeBatch(db);
  let pending = 0;

  for (const ref of refs) {
    batch.delete(ref);
    pending += 1;

    if (pending >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }
}

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
    approvalStatus: 'pending',
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
  let docSnap;
  try {
    docSnap = await getDocFromServer(docRef);
  } catch {
    docSnap = await getDoc(docRef);
  }
  if (docSnap.exists()) {
    return mapInstructorFromSnapshot(docSnap.id, docSnap.data());
  }
  return null;
}

export async function getAllInstructors(): Promise<Instructor[]> {
  let querySnapshot;
  try {
    querySnapshot = await getDocsFromServer(collection(db, 'instructors'));
  } catch {
    querySnapshot = await getDocs(collection(db, 'instructors'));
  }
  return querySnapshot.docs.map((docSnap) =>
    mapInstructorFromSnapshot(docSnap.id, docSnap.data())
  );
}

export async function approveInstructor(instructorId: string, adminId: string) {
  await updateDoc(doc(db, 'instructors', instructorId), {
    approved: true,
    approvalStatus: 'approved',
    approvedAt: serverTimestamp(),
    approvedBy: adminId
  });
}

export async function removeInstructorAccess(instructorId: string) {
  await updateDoc(doc(db, 'instructors', instructorId), {
    approved: false,
    approvalStatus: 'rejected'
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
    maxPlayers: DEFAULT_MAX_PLAYERS,
    playerCount: 0,
    staffingReadyCount: 0,
    turnReadyCount: 0,
    syncEpoch: 0,
    usePregenerated: false,
    asyncMode: false
  };

  await setDoc(doc(db, 'sessions', sessionId), {
    ...session,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt)
  });

  await updateDoc(doc(db, 'instructors', instructorId), {
    sessionsCreated: increment(1),
    lastActive: serverTimestamp()
  });

  return session;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const docRef = doc(db, 'sessions', sessionId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;

  return mapSessionFromSnapshot(docSnap.id, docSnap.data());
}

export async function getSessionByCode(code: string): Promise<Session | null> {
  const q = query(collection(db, 'sessions'), where('code', '==', code.toUpperCase()), limit(1));
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) return null;

  const docSnap = querySnapshot.docs[0];
  return mapSessionFromSnapshot(docSnap.id, docSnap.data());
}

export async function getInstructorSessions(instructorId: string): Promise<Session[]> {
  const q = query(
    collection(db, 'sessions'),
    where('instructorId', '==', instructorId)
  );
  const querySnapshot = await getDocs(q);
  const sessions = querySnapshot.docs.map((docSnap) => mapSessionFromSnapshot(docSnap.id, docSnap.data()));
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
      staffingReadyCount: 0,
      turnReadyCount: 0,
      syncEpoch: 1,
      startedAt: serverTimestamp()
    });
  } else {
    await updateDoc(doc(db, 'sessions', sessionId), {
      status: 'staffing',
      currentHour: 0,
      asyncMode: false,
      staffingReadyCount: 0,
      turnReadyCount: 0,
      syncEpoch: 1,
      startedAt: serverTimestamp()
    });
  }
}

export async function advanceSessionToSequencing(sessionId: string) {
  await runTransaction(db, async (transaction) => {
    const sessionRef = doc(db, 'sessions', sessionId);
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) return;

    const data = sessionSnap.data();
    const nextEpoch = Number(data.syncEpoch ?? 0) + 1;

    transaction.update(sessionRef, {
      status: 'sequencing',
      currentHour: 1,
      turnReadyCount: 0,
      syncEpoch: nextEpoch
    });
  });
}

export async function advanceSessionHour(sessionId: string, newHour: number) {
  const sessionRef = doc(db, 'sessions', sessionId);

  await runTransaction(db, async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) return;

    const sessionData = sessionSnap.data();
    const currentHour = Number(sessionData.currentHour ?? 0);
    const nextEpoch = Number(sessionData.syncEpoch ?? 0) + 1;

    // Only advance if newHour is exactly currentHour + 1 (prevents double-advances)
    if (newHour !== currentHour + 1 && newHour <= 24) return;
    // Also allow completing (newHour > 24) only from hour 24
    if (newHour > 24 && currentHour !== 24) return;

    if (newHour > 24) {
      transaction.update(sessionRef, {
        status: 'completed',
        currentHour: 24,
        turnReadyCount: 0,
        syncEpoch: nextEpoch,
        endedAt: serverTimestamp()
      });
    } else if (sessionData.pauseAfterTurn) {
      transaction.update(sessionRef, {
        status: 'paused',
        pauseAfterTurn: false,
        turnReadyCount: 0,
        syncEpoch: nextEpoch
      });
    } else {
      transaction.update(sessionRef, {
        currentHour: newHour,
        turnReadyCount: 0,
        syncEpoch: nextEpoch
      });
    }
  });
}

export async function markReadyAndMaybeAdvance(
  sessionId: string,
  playerId: string,
  phase: ReadyPhase,
  hour: number,
  epoch?: number
): Promise<ReadyAdvanceResult> {
  return runTransaction(db, async (transaction): Promise<ReadyAdvanceResult> => {
    const sessionRef = doc(db, 'sessions', sessionId);
    const playerRef = doc(db, 'players', playerId);

    const [sessionSnap, playerSnap] = await Promise.all([
      transaction.get(sessionRef),
      transaction.get(playerRef)
    ]);

    if (!sessionSnap.exists() || !playerSnap.exists()) return { advanced: false };

    const sessionData = sessionSnap.data();
    const playerData = playerSnap.data();

    if (sessionData.asyncMode) return { advanced: false };

    const sessionEpoch = Number(sessionData.syncEpoch ?? 0);
    if (typeof epoch === 'number' && epoch !== sessionEpoch) {
      return { advanced: false, stale: true, status: sessionData.status, currentHour: Number(sessionData.currentHour ?? 0) };
    }

    const playerCount = Number(sessionData.playerCount ?? (Array.isArray(sessionData.players) ? sessionData.players.length : 0));
    if (playerCount <= 0) {
      return { advanced: false, status: sessionData.status, currentHour: Number(sessionData.currentHour ?? 0) };
    }

    const playerLastReadyEpoch = Number(playerData.gameState?.lastReadyEpoch ?? -1);
    if (playerLastReadyEpoch === sessionEpoch) {
      return { advanced: false, status: sessionData.status, currentHour: Number(sessionData.currentHour ?? 0) };
    }

    const basePlayerUpdate = { 'gameState.lastReadyEpoch': sessionEpoch } as Record<string, unknown>;

    if (phase === 'staffing') {
      if (sessionData.status !== 'staffing') {
        return { advanced: false, stale: true, status: sessionData.status, currentHour: Number(sessionData.currentHour ?? 0) };
      }
      if (!playerData.gameState?.staffingComplete) {
        return { advanced: false, status: sessionData.status, currentHour: Number(sessionData.currentHour ?? 0) };
      }

      const readyCount = Math.min(playerCount, Number(sessionData.staffingReadyCount ?? 0) + 1);
      transaction.update(playerRef, basePlayerUpdate);

      if (readyCount >= playerCount) {
        const nextEpoch = sessionEpoch + 1;
        transaction.update(sessionRef, {
          staffingReadyCount: readyCount,
          turnReadyCount: 0,
          status: 'sequencing',
          currentHour: 1,
          syncEpoch: nextEpoch
        });
        return { advanced: true, status: 'sequencing', currentHour: 1 };
      }

      transaction.update(sessionRef, {
        staffingReadyCount: readyCount
      });
      return { advanced: false, status: sessionData.status, currentHour: Number(sessionData.currentHour ?? 0) };
    }

    if (sessionData.status !== 'sequencing') {
      return { advanced: false, stale: true, status: sessionData.status, currentHour: Number(sessionData.currentHour ?? 0) };
    }

    const currentHour = Number(sessionData.currentHour ?? 0);
    if (hour !== currentHour) {
      return { advanced: false, stale: true, status: sessionData.status, currentHour };
    }

    const playerLastCompleted = Number(playerData.gameState?.lastCompletedHour ?? 0);
    const playerHourComplete = Boolean(playerData.gameState?.hourComplete);
    if (!playerHourComplete || playerLastCompleted < currentHour) {
      return { advanced: false, status: sessionData.status, currentHour };
    }

    const readyCount = Math.min(playerCount, Number(sessionData.turnReadyCount ?? 0) + 1);
    transaction.update(playerRef, basePlayerUpdate);

    if (readyCount >= playerCount) {
      const nextEpoch = sessionEpoch + 1;

      if (currentHour >= 24) {
        transaction.update(sessionRef, {
          status: 'completed',
          currentHour: 24,
          turnReadyCount: 0,
          syncEpoch: nextEpoch,
          endedAt: serverTimestamp()
        });
        return { advanced: true, status: 'completed', currentHour: 24 };
      }

      if (sessionData.pauseAfterTurn) {
        transaction.update(sessionRef, {
          status: 'paused',
          pauseAfterTurn: false,
          turnReadyCount: 0,
          syncEpoch: nextEpoch
        });
        return { advanced: true, status: 'paused', currentHour };
      }

      const nextHour = currentHour + 1;
      transaction.update(sessionRef, {
        currentHour: nextHour,
        turnReadyCount: 0,
        syncEpoch: nextEpoch
      });
      return { advanced: true, status: 'sequencing', currentHour: nextHour };
    }

    transaction.update(sessionRef, {
      turnReadyCount: readyCount
    });

    return { advanced: false, status: sessionData.status, currentHour };
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

    const sessionData = sessionSnap.data();
    const currentHour = Number(sessionData.currentHour ?? 0);
    const newHour = currentHour + 1;
    const nextEpoch = Number(sessionData.syncEpoch ?? 0) + 1;

    if (newHour > 24) {
      transaction.update(sessionRef, {
        status: 'completed',
        currentHour: 24,
        turnReadyCount: 0,
        pauseAfterTurn: false,
        syncEpoch: nextEpoch,
        endedAt: serverTimestamp()
      });
    } else {
      transaction.update(sessionRef, {
        status: 'sequencing',
        currentHour: newHour,
        turnReadyCount: 0,
        pauseAfterTurn: false,
        syncEpoch: nextEpoch
      });
    }
  });
}

export async function deleteSession(sessionId: string) {
  const playersQuery = query(collection(db, 'players'), where('sessionId', '==', sessionId));
  const playersSnapshot = await getDocs(playersQuery);
  const rosterSnapshot = await getDocs(collection(db, 'sessions', sessionId, 'roster'));

  const refs: DocumentReference[] = [
    ...playersSnapshot.docs.map((docSnap) => docSnap.ref),
    ...rosterSnapshot.docs.map((docSnap) => docSnap.ref),
    doc(db, 'sessions', sessionId)
  ];

  await deleteRefsInBatches(refs);
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
      callback(mapSessionFromSnapshot(docSnap.id, docSnap.data()));
    } else {
      callback(null);
    }
  });
}

type JoinSessionResult = { player: Player; error?: undefined } | { player: null; error: string };

// Player Functions
export async function joinSession(sessionCode: string, playerName: string): Promise<JoinSessionResult> {
  const normalizedCode = sessionCode.toUpperCase();
  const cleanedName = playerName.trim().replace(/\s+/g, ' ');
  try {
    const result = await joinSessionFn({
      sessionCode: normalizedCode,
      playerName: cleanedName
    });

    const data = result.data;
    if (!data?.player) {
      return { player: null, error: 'SESSION_INVALID' };
    }

    return {
      player: mapPlayerFromCallable(data.player)
    };
  } catch (error: any) {
    const detailsCode = error?.details?.code;
    if (typeof detailsCode === 'string') {
      return { player: null, error: detailsCode };
    }

    console.error('joinSession callable failed:', error);
    return { player: null, error: 'SESSION_INVALID' };
  }
}

export async function getPlayerByNameInSession(sessionId: string, name: string): Promise<Player | null> {
  const q = query(
    collection(db, 'players'),
    where('sessionId', '==', sessionId),
    where('name', '==', name),
    limit(1)
  );
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) return null;

  const docSnap = querySnapshot.docs[0];
  return mapPlayerFromSnapshot(docSnap.id, docSnap.data());
}

export async function getPlayer(playerId: string): Promise<Player | null> {
  const docRef = doc(db, 'players', playerId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;

  return mapPlayerFromSnapshot(docSnap.id, docSnap.data());
}

export async function getSessionPlayers(sessionId: string): Promise<Player[]> {
  const q = query(collection(db, 'players'), where('sessionId', '==', sessionId));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((docSnap) => mapPlayerFromSnapshot(docSnap.id, docSnap.data()));
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
  await runTransaction(db, async (transaction) => {
    const playerRef = doc(db, 'players', playerId);
    const playerSnap = await transaction.get(playerRef);
    if (!playerSnap.exists()) return;

    const playerData = playerSnap.data();
    const player = mapPlayerFromSnapshot(playerSnap.id, playerData);
    const sessionRef = doc(db, 'sessions', player.sessionId);
    const sessionSnap = await transaction.get(sessionRef);

    transaction.delete(playerRef);
    transaction.delete(doc(db, 'sessions', player.sessionId, 'roster', getRosterLockId(player.name)));

    if (!sessionSnap.exists()) return;

    const sessionData = sessionSnap.data();
    const currentPlayerCount = Number(sessionData.playerCount ?? (Array.isArray(sessionData.players) ? sessionData.players.length : 0));
    const nextPlayerCount = Math.max(0, currentPlayerCount - 1);

    let staffingReadyCount = Math.min(Number(sessionData.staffingReadyCount ?? 0), nextPlayerCount);
    let turnReadyCount = Math.min(Number(sessionData.turnReadyCount ?? 0), nextPlayerCount);

    const sessionEpoch = Number(sessionData.syncEpoch ?? 0);
    const playerLastReadyEpoch = Number(player.gameState.lastReadyEpoch ?? -1);
    const playerCountsForStaffing = player.gameState.staffingComplete;
    const playerCountsForTurn = player.gameState.hourComplete &&
      Number(player.gameState.lastCompletedHour ?? 0) >= Number(sessionData.currentHour ?? 0);

    if (playerLastReadyEpoch === sessionEpoch) {
      if (sessionData.status === 'staffing' && playerCountsForStaffing) {
        staffingReadyCount = Math.max(0, staffingReadyCount - 1);
      }
      if (sessionData.status === 'sequencing' && playerCountsForTurn) {
        turnReadyCount = Math.max(0, turnReadyCount - 1);
      }
    }

    transaction.update(sessionRef, {
      playerCount: nextPlayerCount,
      players: (Array.isArray(sessionData.players) ? sessionData.players : []).filter((id: string) => id !== playerId),
      staffingReadyCount,
      turnReadyCount
    });
  });
}

export function subscribeToPlayer(playerId: string, callback: (player: Player | null) => void) {
  return onSnapshot(doc(db, 'players', playerId), (docSnap) => {
    if (docSnap.exists()) {
      callback(mapPlayerFromSnapshot(docSnap.id, docSnap.data()));
    } else {
      callback(null);
    }
  });
}

export function subscribeToSessionPlayers(sessionId: string, callback: (players: Player[]) => void) {
  const q = query(collection(db, 'players'), where('sessionId', '==', sessionId));
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = onSnapshot(q, (querySnapshot) => {
    const players = querySnapshot.docs.map((docSnap) => mapPlayerFromSnapshot(docSnap.id, docSnap.data()));

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
    approvalStatus: 'approved',
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

