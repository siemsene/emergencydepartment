// SMTP2GO Email Service
// Configure your SMTP2GO API key in environment variables

const SMTP2GO_API_URL = 'https://api.smtp2go.com/v3/email/send';
const SMTP2GO_API_KEY = import.meta.env.VITE_SMTP2GO_API_KEY || '';
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || '';
const FROM_EMAIL = import.meta.env.VITE_FROM_EMAIL || 'noreply@emergencygame.com';
const FROM_NAME = 'Emergency! Game';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!SMTP2GO_API_KEY) {
    console.warn('SMTP2GO API key not configured. Email not sent.');
    console.log('Would have sent email:', options);
    return false;
  }

  try {
    const response = await fetch(SMTP2GO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: SMTP2GO_API_KEY,
        to: [options.to],
        sender: `${FROM_NAME} <${FROM_EMAIL}>`,
        subject: options.subject,
        html_body: options.html,
        text_body: options.text || options.html.replace(/<[^>]*>/g, '')
      })
    });

    const result = await response.json();
    return result.data?.succeeded > 0;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

export async function notifyAdminNewInstructor(instructorName: string, instructorEmail: string, organization?: string): Promise<boolean> {
  if (!ADMIN_EMAIL) {
    console.warn('Admin email not configured.');
    return false;
  }

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: 'New Instructor Registration - Emergency! Game',
    html: `
      <h2>New Instructor Registration</h2>
      <p>A new instructor has registered and is awaiting approval:</p>
      <ul>
        <li><strong>Name:</strong> ${instructorName}</li>
        <li><strong>Email:</strong> ${instructorEmail}</li>
        ${organization ? `<li><strong>Organization:</strong> ${organization}</li>` : ''}
      </ul>
      <p>Please log in to the admin dashboard to approve or reject this request.</p>
    `
  });
}

export async function notifyInstructorApproved(instructorEmail: string, instructorName: string): Promise<boolean> {
  return sendEmail({
    to: instructorEmail,
    subject: 'Your Instructor Account Has Been Approved - Emergency! Game',
    html: `
      <h2>Account Approved!</h2>
      <p>Hello ${instructorName},</p>
      <p>Your instructor account for the Emergency! Game has been approved. You can now log in and create game sessions.</p>
      <p>Thank you for using Emergency! Game for your educational needs.</p>
    `
  });
}

export async function notifyInstructorRejected(instructorEmail: string, instructorName: string): Promise<boolean> {
  return sendEmail({
    to: instructorEmail,
    subject: 'Instructor Account Status - Emergency! Game',
    html: `
      <h2>Account Status Update</h2>
      <p>Hello ${instructorName},</p>
      <p>Unfortunately, your instructor account request has not been approved at this time.</p>
      <p>If you believe this is an error, please contact the administrator.</p>
    `
  });
}

export async function sendPasswordResetEmail(email: string, resetLink: string): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: 'Password Reset - Emergency! Game',
    html: `
      <h2>Password Reset Request</h2>
      <p>You have requested to reset your password for the Emergency! Game.</p>
      <p>Click the link below to reset your password:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>If you did not request this, please ignore this email.</p>
      <p>This link will expire in 1 hour.</p>
    `
  });
}
