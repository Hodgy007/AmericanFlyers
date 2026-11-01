// The text of the Privacy dialog (see privacyUi.ts, which loads this file the
// first time the dialog opens).
//
// DRAFT, NOT LEGAL ADVICE: this is a plain-English description of what the app
// does today, written by the developers. The site owner should read it, check it
// against how the app is actually run (hosting, Sentry, retention) and have it
// reviewed before relying on it. Keep it in step with db/schema.sql and
// docs/user-guide/privacy-and-your-data.md when the app collects something new.

export const PRIVACY_HTML = `
  <p class="muted small">Last updated 1 November 2026.</p>
  <p>American Flyers is a free, hobby-built indoor cycling app. We collect only what the ride needs. We don’t sell your data, show ads, or share it with advertisers.</p>

  <h3>What we collect</h3>
  <ul>
    <li><strong>Your account:</strong> your name and email address, and a password if you use email sign-in. Passwords are handled by Neon Auth (our sign-in provider) and are stored hashed; we never see them. If you use Google, we receive your name, email and picture from Google, and nothing else.</li>
    <li><strong>Your rider details:</strong> weight, FTP, heart-rate settings and your app settings (units, kit colours, camera, sound and so on).</li>
    <li><strong>Your rides:</strong> each saved ride, with a power, cadence, heart-rate, speed, distance and height reading every second, plus totals such as time, climbing and energy. Your workouts, routes and FTP history.</li>
    <li><strong>Live position while you ride together:</strong> which stage you are on, how far along, speed, power and cadence, and your kit colours. It is replaced every few seconds and removed after about 10 minutes of silence.</li>
    <li><strong>Ride-ons:</strong> the thumbs-up, flame and other cheers riders send each other. They are cleared after a day.</li>
    <li><strong>Feedback:</strong> messages you send from “Ideas &amp; bug reports”, with the stage, browser and trainer name at that moment.</li>
    <li><strong>Error reports:</strong> if the site owner has turned it on, Sentry receives crash reports and slow-page samples. They carry your anonymous account id, not your name, email or IP-based details, and no session recordings.</li>
  </ul>
  <p>We don’t ask for your phone number, address or payment details. Riding without an account stores your settings only in your own browser.</p>

  <h3>What other riders see</h3>
  <ul>
    <li>Your <strong>first name and last initial</strong> (for example “Alex M.”), your position on the road, your speed and your kit, while you ride on the same stage.</li>
    <li>Your first name and initial and your <strong>finish times</strong> on a stage’s leaderboard, and the ghost of your ride if someone races it. Ghosts show distance over time only, not your power or heart rate.</li>
    <li>When you send or receive a ride-on, the sender’s first name and initial.</li>
  </ul>
  <p>Nobody sees your email, weight, FTP, heart rate, or your other rides. The people who run the app can see accounts and feedback in an admin dashboard so they can help and keep it fair.</p>

  <h3>Where it is kept</h3>
  <ul>
    <li><strong>Neon</strong> (Postgres database and sign-in), in the EU West 2 (London) region. Each table is protected so an account can only read its own rows.</li>
    <li><strong>Vercel</strong> hosts the website. Like any host, it sees normal request details such as your IP address and browser in its logs.</li>
    <li><strong>Google Fonts</strong> supplies the typefaces, and <strong>Google</strong> handles sign-in if you choose it.</li>
    <li><strong>Sentry</strong>, for crash reports, only if switched on.</li>
  </ul>

  <h3>How long we keep it</h3>
  <p>Your rides, workouts, routes, settings and feedback are kept until you delete them or delete your account. Live positions and ride-ons are short-lived, as above. Verification codes expire after 15 minutes.</p>

  <h3>Your choices</h3>
  <ul>
    <li><strong>Download my data</strong> gives you everything we store about you as a file.</li>
    <li><strong>Delete my account</strong> permanently removes your account and all of the above. Both are in your profile, under “Privacy &amp; data”.</li>
    <li>You can delete single rides, workouts and routes at any time, and ride without an account.</li>
    <li>Questions or requests: use “Ideas &amp; bug reports” in the menu, or ask the person who runs your copy of the app.</li>
  </ul>
  <p class="muted small">This page describes the app in good faith and is not legal advice.</p>`;
