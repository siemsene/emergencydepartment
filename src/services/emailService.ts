// Email Service - calls Cloud Function for all email sending
import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../config/firebase';

const functions = getFunctions(app);
const sendEmailFn = httpsCallable(functions, 'sendEmail');

export async function notifyAdminNewInstructor(
  instructorName: string,
  instructorEmail: string,
  organization?: string
): Promise<boolean> {
  try {
    const result = await sendEmailFn({
      action: 'notifyAdminNewInstructor',
      instructorName,
      instructorEmail,
      organization
    });
    return (result.data as { success: boolean }).success;
  } catch (error) {
    console.error('Failed to send admin notification email:', error);
    return false;
  }
}

export async function notifyInstructorApproved(
  instructorEmail: string,
  instructorName: string
): Promise<boolean> {
  try {
    const result = await sendEmailFn({
      action: 'notifyInstructorApproved',
      instructorEmail,
      instructorName
    });
    return (result.data as { success: boolean }).success;
  } catch (error) {
    console.error('Failed to send instructor approved email:', error);
    return false;
  }
}

export async function notifyInstructorRejected(
  instructorEmail: string,
  instructorName: string
): Promise<boolean> {
  try {
    const result = await sendEmailFn({
      action: 'notifyInstructorRejected',
      instructorEmail,
      instructorName
    });
    return (result.data as { success: boolean }).success;
  } catch (error) {
    console.error('Failed to send instructor rejected email:', error);
    return false;
  }
}

export async function sendPasswordResetEmail(
  email: string,
  resetLink: string
): Promise<boolean> {
  try {
    const result = await sendEmailFn({
      action: 'sendPasswordResetEmail',
      email,
      resetLink
    });
    return (result.data as { success: boolean }).success;
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return false;
  }
}
