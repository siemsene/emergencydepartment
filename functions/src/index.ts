import {setGlobalOptions} from "firebase-functions";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onMessagePublished} from "firebase-functions/v2/pubsub";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {CloudBillingClient} from "@google-cloud/billing";

setGlobalOptions({maxInstances: 10});

admin.initializeApp();

const PLAYER_DELETE_BATCH_SIZE = 400;
const ROSTER_DELETE_BATCH_SIZE = 400;
const DEFAULT_MAX_PLAYERS = 150;
const SESSION_CODE_LENGTH = 6;
const MAX_PLAYER_NAME_LENGTH = 80;

// Secrets
const smtp2goApiKey = defineSecret("SMTP2GO_API_KEY");
const adminEmail = defineSecret("ADMIN_EMAIL");
const fromEmail = defineSecret("FROM_EMAIL");

/**
 * HTML-escape a string to prevent injection.
 * @param {string} str The string to escape.
 * @return {string} The escaped string.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Deletes all players linked to the provided session.
 * @param {admin.firestore.Firestore} db Firestore instance.
 * @param {string} sessionId Session ID to clean up.
 * @return {Promise<number>} Number of deleted players.
 */
async function deleteSessionPlayers(
  db: admin.firestore.Firestore,
  sessionId: string
): Promise<number> {
  let deletedCount = 0;
  let hasMorePlayers = true;

  while (hasMorePlayers) {
    const playersSnapshot = await db
      .collection("players")
      .where("sessionId", "==", sessionId)
      .limit(PLAYER_DELETE_BATCH_SIZE)
      .get();

    if (playersSnapshot.empty) {
      hasMorePlayers = false;
      continue;
    }

    const batch = db.batch();
    playersSnapshot.docs.forEach((playerDoc) => {
      batch.delete(playerDoc.ref);
    });

    await batch.commit();
    deletedCount += playersSnapshot.size;
  }

  return deletedCount;
}

/**
 * Deletes all roster lock docs linked to the provided session.
 * @param {admin.firestore.Firestore} db Firestore instance.
 * @param {string} sessionId Session ID to clean up.
 * @return {Promise<number>} Number of deleted roster docs.
 */
async function deleteSessionRosterEntries(
  db: admin.firestore.Firestore,
  sessionId: string
): Promise<number> {
  let deletedCount = 0;
  let hasMoreRoster = true;

  while (hasMoreRoster) {
    const rosterSnapshot = await db
      .collection("sessions")
      .doc(sessionId)
      .collection("roster")
      .limit(ROSTER_DELETE_BATCH_SIZE)
      .get();

    if (rosterSnapshot.empty) {
      hasMoreRoster = false;
      continue;
    }

    const batch = db.batch();
    rosterSnapshot.docs.forEach((rosterDoc) => {
      batch.delete(rosterDoc.ref);
    });

    await batch.commit();
    deletedCount += rosterSnapshot.size;
  }

  return deletedCount;
}

export const cleanupExpiredSessions = onSchedule(
  "every 168 hours",
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromDate(
      new Date()
    );

    const expiredSessionsSnapshot = await db
      .collection("sessions")
      .where("expiresAt", "<=", cutoff)
      .get();

    if (expiredSessionsSnapshot.empty) {
      logger.info(
        "No expired sessions found for cleanup."
      );
      return;
    }

    let sessionsDeleted = 0;
    let playersDeleted = 0;
    let rosterLocksDeleted = 0;

    for (const sessionDoc of expiredSessionsSnapshot.docs) {
      const sessionId = sessionDoc.id;
      playersDeleted += await deleteSessionPlayers(
        db, sessionId
      );
      rosterLocksDeleted +=
        await deleteSessionRosterEntries(db, sessionId);
      await sessionDoc.ref.delete();
      sessionsDeleted += 1;
    }

    logger.info("Expired session cleanup complete.", {
      sessionsDeleted,
      playersDeleted,
      rosterLocksDeleted,
      retentionDays: 30,
    });
  }
);

// ---- Email Cloud Function ----

const SMTP2GO_API_URL = "https://api.smtp2go.com/v3/email/send";
const FROM_NAME = "Emergency! Game";

type EmailAction =
  | "notifyAdminNewInstructor"
  | "notifyInstructorApproved"
  | "notifyInstructorRejected"
  | "sendPasswordResetEmail";

interface SendEmailData {
  action: EmailAction;
  instructorName?: string;
  instructorEmail?: string;
  organization?: string;
  email?: string;
  resetLink?: string;
}

interface JoinSessionData {
  sessionCode?: unknown;
  playerName?: unknown;
}

interface CallablePlayer {
  id: string;
  name: string;
  sessionId: string;
  joinedAt: string;
  isConnected: boolean;
  lastSeen: string;
  nudgedAt?: number;
  gameState: Record<string, unknown>;
}

interface JoinSessionResponse {
  player: CallablePlayer;
  reusedExistingPlayer: boolean;
}

/**
 * Normalizes a player name for comparisons.
 * @param {string} name Player-provided name.
 * @return {string} Normalized name.
 */
function normalizePlayerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Builds the roster document ID for a player name.
 * @param {string} name Player-provided name.
 * @return {string} Roster lock ID.
 */
function getRosterLockId(name: string): string {
  const normalized = normalizePlayerName(name)
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, MAX_PLAYER_NAME_LENGTH);

  return normalized || "player";
}

/**
 * Validates and normalizes join-session request data.
 * @param {JoinSessionData} data Raw callable request data.
 * @return {{sessionCode: string, playerName: string}} Normalized data.
 */
function parseJoinSessionData(
  data: JoinSessionData
): { sessionCode: string; playerName: string } {
  if (typeof data.sessionCode !== "string" ||
      typeof data.playerName !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "sessionCode and playerName are required",
      {code: "INVALID_ARGUMENT"}
    );
  }

  const sessionCode = data.sessionCode.trim().toUpperCase();
  const playerName = data.playerName.trim().replace(/\s+/g, " ");

  if (sessionCode.length < SESSION_CODE_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      "Session code must be at least 6 characters",
      {code: "INVALID_ARGUMENT"}
    );
  }

  if (!playerName || playerName.length > MAX_PLAYER_NAME_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      "Player name is invalid",
      {code: "INVALID_ARGUMENT"}
    );
  }

  return {sessionCode, playerName};
}

/**
 * Returns the initial game state for a new player.
 * @return {Record<string, unknown>} Default game state.
 */
function initializePlayerGameState(): Record<string, unknown> {
  return {
    rooms: [],
    waitingRoom: [],
    completedPatients: [],
    totalRevenue: 0,
    totalCost: 0,
    staffingCost: 0,
    staffingComplete: false,
    currentPhase: "arriving",
    currentHour: 0,
    hourComplete: false,
    lastCompletedHour: 0,
    lastArrivalsHour: 0,
    lastTreatmentHour: 0,
    lastSequencingHour: 0,
    stateVersion: 0,
    lastReadyEpoch: -1,
    stats: {
      patientsTreated: {A: 0, B: 0, C: 0},
      cardiacArrests: 0,
      lwbs: {B: 0, C: 0},
      turnedAway: {A: 0, B: 0, C: 0},
      waitingCosts: 0,
      riskEventCosts: 0,
      hourlyUtilization: [],
      hourlyQueueLength: [],
      hourlyDemand: {A: [], B: [], C: []},
      hourlyAvailableCapacity: {A: [], B: [], C: []},
      maxWaitingTime: {A: 0, B: 0, C: 0},
      mismatchTreatments: 0,
      totalTreatments: 0,
    },
    turnEvents: {
      arrived: {A: 0, B: 0, C: 0},
      turnedAway: {A: 0, B: 0, C: 0},
      riskEvents: [],
      completed: [],
      waitingCosts: 0,
    },
  };
}

/**
 * Finds a session by public code, falling back to a direct document lookup.
 * @param {admin.firestore.Firestore} db Firestore instance.
 * @param {string} sessionCode Public session code or document ID.
 * @return {Promise<admin.firestore.DocumentSnapshot | null>} Matching session.
 */
async function findSessionForJoin(
  db: admin.firestore.Firestore,
  sessionCode: string
): Promise<admin.firestore.DocumentSnapshot | null> {
  const codeSnapshot = await db
    .collection("sessions")
    .where("code", "==", sessionCode)
    .limit(1)
    .get();

  if (!codeSnapshot.empty) {
    return codeSnapshot.docs[0];
  }

  const sessionSnapshot = await db
    .collection("sessions")
    .doc(sessionCode)
    .get();
  return sessionSnapshot.exists ? sessionSnapshot : null;
}

/**
 * Maps Firestore player data into a callable response payload.
 * @param {string} playerId Firestore player doc ID.
 * @param {admin.firestore.DocumentData} data Raw player data.
 * @return {CallablePlayer} Serializable player payload.
 */
function mapCallablePlayer(
  playerId: string,
  data: admin.firestore.DocumentData
): CallablePlayer {
  const joinedAt = data.joinedAt?.toDate?.() ?? new Date();
  const lastSeen = data.lastSeen?.toDate?.() ?? new Date();

  return {
    id: playerId,
    name: String(data.name || ""),
    sessionId: String(data.sessionId || ""),
    joinedAt: joinedAt.toISOString(),
    isConnected: Boolean(data.isConnected),
    lastSeen: lastSeen.toISOString(),
    nudgedAt: typeof data.nudgedAt === "number" ? data.nudgedAt : undefined,
    gameState: (data.gameState as Record<string, unknown>) ??
      initializePlayerGameState(),
  };
}

export const joinSession = onCall(
  {
    enforceAppCheck: true,
  },
  async (request): Promise<JoinSessionResponse> => {
    const {sessionCode, playerName} =
      parseJoinSessionData((request.data ?? {}) as JoinSessionData);

    const db = admin.firestore();
    const initialSession = await findSessionForJoin(db, sessionCode);

    if (!initialSession) {
      throw new HttpsError(
        "failed-precondition",
        "Invalid session code or session has expired",
        {code: "SESSION_INVALID"}
      );
    }

    return db.runTransaction(async (transaction) => {
      const sessionSnap = await transaction.get(initialSession.ref);

      if (!sessionSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Invalid session code or session has expired",
          {code: "SESSION_INVALID"}
        );
      }

      const sessionData = sessionSnap.data() || {};
      const sessionStatus = String(sessionData.status || "");
      const expiresAt = sessionData.expiresAt?.toDate?.() ?? new Date(0);

      if (sessionStatus === "completed" || new Date() > expiresAt) {
        throw new HttpsError(
          "failed-precondition",
          "Invalid session code or session has expired",
          {code: "SESSION_INVALID"}
        );
      }

      const maxPlayers = Number(sessionData.maxPlayers ?? DEFAULT_MAX_PLAYERS);
      const playerCount = Number(
        sessionData.playerCount ??
        (Array.isArray(sessionData.players) ? sessionData.players.length : 0)
      );

      const rosterRef = sessionSnap.ref
        .collection("roster")
        .doc(getRosterLockId(playerName));
      const rosterSnap = await transaction.get(rosterRef);

      if (rosterSnap.exists) {
        const existingPlayerId = String(rosterSnap.data()?.playerId || "");
        if (existingPlayerId) {
          const existingPlayerRef = db
            .collection("players")
            .doc(existingPlayerId);
          const existingPlayerSnap = await transaction.get(existingPlayerRef);

          if (existingPlayerSnap.exists) {
            if (sessionStatus === "setup") {
              throw new HttpsError(
                "already-exists",
                "That name is already taken in this session",
                {code: "NAME_TAKEN"}
              );
            }

            transaction.update(existingPlayerRef, {
              isConnected: true,
              lastSeen: admin.firestore.FieldValue.serverTimestamp(),
            });

            return {
              player: mapCallablePlayer(existingPlayerSnap.id, {
                ...existingPlayerSnap.data(),
                isConnected: true,
                lastSeen: admin.firestore.Timestamp.now(),
              }),
              reusedExistingPlayer: true,
            };
          }
        }
      }

      if (playerCount >= maxPlayers) {
        throw new HttpsError(
          "resource-exhausted",
          "Session is full",
          {code: "SESSION_FULL"}
        );
      }

      const playerRef = db.collection("players").doc();
      const playerWriteData = {
        id: playerRef.id,
        name: playerName,
        sessionId: sessionSnap.id,
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        isConnected: true,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        gameState: initializePlayerGameState(),
      };

      transaction.set(playerRef, playerWriteData);
      transaction.set(rosterRef, {
        playerId: playerRef.id,
        normalizedName: normalizePlayerName(playerName),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.update(sessionSnap.ref, {
        playerCount: admin.firestore.FieldValue.increment(1),
        players: admin.firestore.FieldValue.arrayUnion(playerRef.id),
      });

      return {
        player: mapCallablePlayer(playerRef.id, {
          ...playerWriteData,
          joinedAt: admin.firestore.Timestamp.now(),
          lastSeen: admin.firestore.Timestamp.now(),
        }),
        reusedExistingPlayer: false,
      };
    });
  }
);

export const sendEmail = onCall(
  {
    secrets: [smtp2goApiKey, adminEmail, fromEmail],
    enforceAppCheck: true,
  },
  async (request) => {
    const data = request.data as SendEmailData;

    if (!data.action) {
      throw new HttpsError("invalid-argument", "Missing action field");
    }

    const apiKey = smtp2goApiKey.value().trim();
    const adminAddr = adminEmail.value().trim().toLowerCase();
    const fromAddr = fromEmail.value().trim() || "noreply@emergencygame.com";

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const callerEmail = (request.auth.token.email || "").toLowerCase();
    const adminOnlyActions: EmailAction[] = [
      "notifyInstructorApproved",
      "notifyInstructorRejected",
      "sendPasswordResetEmail",
    ];
    if (adminOnlyActions.includes(data.action)) {
      if (!adminAddr) {
        throw new HttpsError(
          "failed-precondition",
          "Admin email secret not configured"
        );
      }
      if (callerEmail !== adminAddr) {
        logger.warn("Admin check failed", {
          callerEmail,
          adminAddr,
          action: data.action,
        });
        throw new HttpsError(
          "permission-denied",
          "Only admin can perform this action"
        );
      }
    }


    if (!apiKey) {
      logger.warn("SMTP2GO API key not configured. Email not sent.");
      return {success: false, reason: "not_configured"};
    }

    let to: string;
    let subject: string;
    let html: string;

    switch (data.action) {
    case "notifyAdminNewInstructor": {
      if (!data.instructorName || !data.instructorEmail) {
        throw new HttpsError(
          "invalid-argument",
          "Missing instructorName or instructorEmail"
        );
      }
      if (!adminAddr) {
        return {success: false, reason: "admin_email_not_configured"};
      }
      const safeName = escapeHtml(data.instructorName);
      const safeEmail = escapeHtml(data.instructorEmail);
      const safeOrg = data.organization ?
        escapeHtml(data.organization) : "";

      to = adminAddr;
      subject = "New Instructor Registration - Emergency! Game";
      html = `
          <h2>New Instructor Registration - Emergency! Game</h2>
          <p>A new instructor has registered for the
          <strong>Emergency! Game</strong>
          (Emergency Department simulation)
          and is awaiting approval:</p>
          <ul>
            <li><strong>Name:</strong> ${safeName}</li>
            <li><strong>Email:</strong> ${safeEmail}</li>
            ${safeOrg ?
    `<li><strong>Organization:</strong> ${safeOrg}</li>` : ""}
          </ul>
          <p>Please log in to the admin dashboard to approve or reject
          this request.</p>
        `;
      break;
    }
    case "notifyInstructorApproved": {
      if (!data.instructorEmail || !data.instructorName) {
        throw new HttpsError(
          "invalid-argument",
          "Missing instructorEmail or instructorName"
        );
      }
      const safeName = escapeHtml(data.instructorName);
      to = data.instructorEmail;
      subject =
          "Your Instructor Account Has Been Approved - Emergency! Game";
      html = `
          <h2>Account Approved!</h2>
          <p>Hello ${safeName},</p>
          <p>Your instructor account for the Emergency! Game has been
          approved. You can now log in and create game sessions.</p>
          <p>Thank you for using Emergency! Game for your educational
          needs.</p>
        `;
      break;
    }
    case "notifyInstructorRejected": {
      if (!data.instructorEmail || !data.instructorName) {
        throw new HttpsError(
          "invalid-argument",
          "Missing instructorEmail or instructorName"
        );
      }
      const safeName = escapeHtml(data.instructorName);
      to = data.instructorEmail;
      subject = "Instructor Account Status - Emergency! Game";
      html = `
          <h2>Account Status Update</h2>
          <p>Hello ${safeName},</p>
          <p>Unfortunately, your instructor account request has not been
          approved at this time.</p>
          <p>If you believe this is an error, please contact the
          administrator.</p>
        `;
      break;
    }
    case "sendPasswordResetEmail": {
      if (!data.email || !data.resetLink) {
        throw new HttpsError(
          "invalid-argument",
          "Missing email or resetLink"
        );
      }
      to = data.email;
      subject = "Password Reset - Emergency! Game";
      const safeLink = escapeHtml(data.resetLink);
      html = `
          <h2>Password Reset Request</h2>
          <p>You have requested to reset your password for the
          Emergency! Game.</p>
          <p>Click the link below to reset your password:</p>
          <p><a href="${safeLink}">${safeLink}</a></p>
          <p>If you did not request this, please ignore this email.</p>
          <p>This link will expire in 1 hour.</p>
        `;
      break;
    }
    default:
      throw new HttpsError(
        "invalid-argument",
        `Unknown action: ${data.action}`
      );
    }

    try {
      const response = await fetch(SMTP2GO_API_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          api_key: apiKey,
          to: [to],
          sender: `${FROM_NAME} <${fromAddr}>`,
          subject,
          html_body: html,
          text_body: html.replace(/<[^>]*>/g, ""),
        }),
      });

      const result = await response.json();
      const succeeded = result.data?.succeeded > 0;

      if (!succeeded) {
        logger.warn("Email send failed", {action: data.action, result});
      }

      return {success: succeeded};
    } catch (error) {
      logger.error("Failed to send email:", error);
      return {success: false, reason: "send_error"};
    }
  }
);

// ---- Billing Kill Switch ----
// Listens to a Pub/Sub topic that the GCP budget posts to, and disables
// billing on the project when actual spend exceeds the budget amount.
// Attach a budget in Billing → Budgets & alerts to the topic name below.

interface BudgetNotification {
  budgetDisplayName: string;
  costAmount: number;
  costIntervalStart: string;
  budgetAmount: number;
  budgetAmountType: string;
  currencyCode: string;
}

export const stopBillingOnBudgetExceeded = onMessagePublished(
  {topic: "billing-alerts", region: "us-central1"},
  async (event) => {
    const payload = event.data.message.json as BudgetNotification | undefined;

    if (!payload) {
      logger.warn("Budget notification missing JSON payload");
      return;
    }

    const {costAmount, budgetAmount, budgetDisplayName} = payload;

    if (typeof costAmount !== "number" || typeof budgetAmount !== "number") {
      logger.warn("Budget notification malformed", {payload});
      return;
    }

    if (costAmount <= budgetAmount) {
      logger.info("Budget alert received, under cap — no action.", {
        budgetDisplayName,
        costAmount,
        budgetAmount,
      });
      return;
    }

    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (!projectId) {
      logger.error("Cannot determine project ID; aborting kill switch.");
      return;
    }

    const projectName = `projects/${projectId}`;
    const billing = new CloudBillingClient();

    const [billingInfo] = await billing.getProjectBillingInfo({
      name: projectName,
    });

    if (!billingInfo.billingEnabled) {
      logger.info("Billing already disabled on project; no action.", {
        projectId,
      });
      return;
    }

    logger.error("BUDGET EXCEEDED — DISABLING BILLING ON PROJECT", {
      projectId,
      budgetDisplayName,
      costAmount,
      budgetAmount,
    });

    await billing.updateProjectBillingInfo({
      name: projectName,
      projectBillingInfo: {billingAccountName: ""},
    });

    logger.error("Billing disabled. Project will stop serving traffic.", {
      projectId,
    });
  }
);
