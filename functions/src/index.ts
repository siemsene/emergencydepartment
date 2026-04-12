import {setGlobalOptions} from "firebase-functions";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

setGlobalOptions({maxInstances: 10});

admin.initializeApp();

const PLAYER_DELETE_BATCH_SIZE = 400;
const ROSTER_DELETE_BATCH_SIZE = 400;

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

export const sendEmail = onCall(
  {secrets: [smtp2goApiKey, adminEmail, fromEmail]},
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
