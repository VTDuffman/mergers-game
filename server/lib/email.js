import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// The "from" address must be a verified sender in your Resend account.
// For testing you can use: onboarding@resend.dev (Resend's sandbox address).
// Set EMAIL_FROM in server/.env once your domain is verified.
const FROM = process.env.EMAIL_FROM || 'Hotel Shenanigans <onboarding@resend.dev>';

// The public URL of the app — used to build links in emails.
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

/**
 * Sends a game invitation email with a deep-link back to the app.
 * @param {string} to        - Recipient email address
 * @param {string} gameName  - Name of the game lobby
 * @param {string} inviteId  - UUID of the invite row (used to build the accept link)
 */
export async function sendInviteEmail(to, gameName, inviteId) {
  // The invite link routes the user directly to the pending invite on the dashboard.
  const inviteUrl = `${APP_URL}?invite=${inviteId}`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: `You've been invited to play ${gameName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">You've been invited!</h2>
        <p>You have been invited to join <strong>${gameName}</strong> on Hotel Shenanigans.</p>
        <p>
          <a href="${inviteUrl}"
             style="display:inline-block;background:#3b82f6;color:white;padding:10px 20px;
                    border-radius:6px;text-decoration:none;font-weight:600">
            View Invitation
          </a>
        </p>
        <p style="color:#64748b;font-size:0.875rem">
          If you didn't expect this email, you can safely ignore it.
        </p>
      </div>
    `,
  });
}

/**
 * Sends a "your turn" notification email.
 * @param {string} to        - Recipient email address
 * @param {string} gameName  - Name of the game
 * @param {string} gameId    - UUID of the game (used to build the deep-link)
 */
export async function sendTurnNotificationEmail(to, gameName, gameId) {
  const gameUrl = `${APP_URL}?game=${gameId}`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: `It's your turn in ${gameName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">Your turn!</h2>
        <p>It is now your turn in <strong>${gameName}</strong>.</p>
        <p>
          <a href="${gameUrl}"
             style="display:inline-block;background:#3b82f6;color:white;padding:10px 20px;
                    border-radius:6px;text-decoration:none;font-weight:600">
            Play Your Turn
          </a>
        </p>
      </div>
    `,
  });
}

/**
 * Sends a "merger decision needed" notification email.
 * @param {string} to        - Recipient email address
 * @param {string} gameName  - Name of the game
 * @param {string} gameId    - UUID of the game
 */
export async function sendMergerDecisionEmail(to, gameName, gameId) {
  const gameUrl = `${APP_URL}?game=${gameId}`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: `Merger decision needed in ${gameName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">Your decision is needed</h2>
        <p>A merger has been triggered in <strong>${gameName}</strong> and it is your turn to decide what to do with your stock.</p>
        <p>
          <a href="${gameUrl}"
             style="display:inline-block;background:#f59e0b;color:white;padding:10px 20px;
                    border-radius:6px;text-decoration:none;font-weight:600">
            Submit Your Decision
          </a>
        </p>
      </div>
    `,
  });
}
