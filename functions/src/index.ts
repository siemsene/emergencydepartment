/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

admin.initializeApp();

const PLAYER_DELETE_BATCH_SIZE = 400;

/**
 * Deletes all players linked to the provided session.
 * @param {admin.firestore.Firestore} db Firestore admin instance.
 * @param {string} sessionId Session identifier to clean up.
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

export const cleanupExpiredSessions = onSchedule("every 24 hours", async () => {
  const db = admin.firestore();
  const cutoff = admin.firestore.Timestamp.fromDate(new Date());

  const expiredSessionsSnapshot = await db
    .collection("sessions")
    .where("expiresAt", "<=", cutoff)
    .get();

  if (expiredSessionsSnapshot.empty) {
    logger.info("No expired sessions found for cleanup.");
    return;
  }

  let sessionsDeleted = 0;
  let playersDeleted = 0;

  for (const sessionDoc of expiredSessionsSnapshot.docs) {
    const sessionId = sessionDoc.id;
    playersDeleted += await deleteSessionPlayers(db, sessionId);
    await sessionDoc.ref.delete();
    sessionsDeleted += 1;
  }

  logger.info("Expired session cleanup complete.", {
    sessionsDeleted,
    playersDeleted,
    retentionDays: 30,
  });
});

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
