# Accounts and profile

This page covers signing in (Google, or email and password), what syncs to your account, when rides are saved, the profile tabs, `.tcx` export, deleting rides, renaming and signing out.

## Sign in

1. Click **👤 Sign in** (or use the home page).
2. Choose **Continue with Google**, and you're taken to Google and brought back signed in.
3. Or use your email:
   - **Create account**: your rider name, email, a password (at least 8 characters), your weight, and your FTP if you know it. That's all: no phone number, no address. You're signed in straight away, and your weight and FTP are saved to your settings.
   - **Sign in**: your email and password.
   - **Forgot password?**: enter your email and we send a link (valid for 15 minutes). Open it, set a new password, then sign in with it.

Other riders only ever see your rider name shortened to first name and initial, for example *Dave S.*

Riding without an account works fine. Your settings stay in the browser. Signing in is needed for saved rides, profile stats, achievements, feedback and sync across devices.

## What syncs

When you're signed in, these are kept in your account:

| Data | How it syncs |
| --- | --- |
| **Settings** | Saved about 0.8 seconds after your last change. |
| **Workouts** you created or uploaded | Saved as soon as you save them, and removed when you delete them. |
| **Routes** you uploaded | Saved as soon as you upload them, and removed when you delete them. |
| **Rides** | Saved at the moments listed under [When rides are saved](#when-rides-are-saved). |
| **FTP history** | Recorded each time your FTP changes. |
| **Feedback** you send | Stored with your account, so you can see replies. |

### Privacy & data

The profile's **🔒 Privacy & data** tab has **Download my data** (a JSON file of everything stored about you) and **Delete my account**. See [Privacy and your data](privacy-and-your-data.md).

### Verifying your email

If your email address isn't verified, a note at the top of your profile offers **Email me a code**. Type the 6-digit code from the email (it works for 15 minutes; you can ask for a new one after 30 seconds). When email verification is switched on for new accounts, the code box also appears right after you create an account or sign in. Google accounts are already verified.

### When you sign in on a browser

The sign-in step merges what's in the browser with what's in your account:

- **Settings:** if your account already has settings, they replace the browser's. If not, the browser's settings are copied to your account.
- **Workouts and routes:** anything in the browser that your account doesn't have yet is uploaded. Then the browser copies of workouts and routes match your account.
- **Pending ride:** a ride you were trying to save when you signed in is saved (see below).

### When you sign out

Signing out removes your workouts and routes from that browser. They stay in your account, and come back when you sign in again. Your settings stay in the browser. Your rides stay in your account.

## When rides are saved

A ride is saved to your account when:

- you **finish a stage** (crossing the finish line),
- you **complete a workout**,
- you press **Reset** after riding for at least a minute, or start a new ride or choose a new stage after riding that long, or
- **every 5 minutes** while you ride, for a ride that's at least a minute long and has gained more than a minute since its last save.

Rides shorter than **one minute** aren't saved. A ride is saved again, in place, each time it's updated, so a long ride doesn't turn into several rides.

You must be signed in for any of this to happen. If you're not signed in, a ride isn't saved. The summary card shows a link to sign in.

### Sign in to save from the summary

If you're not signed in when the ride summary appears, it offers **Sign in** so you can keep the ride:

1. Click **Sign in** in the summary.
2. The ride is kept in your browser, and the sign-in dialog opens.
3. After you sign in, the ride is saved to your profile, and you see *Your ride was saved to your profile.*

If you close the summary and start a new ride without signing in, the ride isn't kept.

## The profile

Click your name (👤) to open your profile. It has these tabs:

### Stats

- **Totals:** rides, time, distance, climbing, energy, and your FTP and W/kg.
- **Personal bests:** your best 5-second, 1-minute, 5-minute and 20-minute power, with when you set each one.
- **Distance per week:** the last 12 weeks.
- **FTP progress:** every FTP entry, with its source. See [Zones and FTP](zones-and-ftp.md#ftp-history).
- **Zones across all rides:** the total time in heart-rate and power zones. See [Zones and FTP](zones-and-ftp.md).

### Achievements

A grid of every achievement, with progress and dates. See [Achievements](achievements.md).

### Rides

Your most recent 1,000 rides, newest first. Each ride is a row showing its date, title, time, distance, average power and a flag if you finished a stage. Open a row to see:

- stat tiles for the ride, including best efforts,
- heart-rate and power zone bars,
- power and heart-rate charts over time,
- **⬇ Export .tcx**, and
- **🗑 Delete ride**.

### Admin

Shown only to admins. See the [admin dashboard](../admin-guide/admin-dashboard.md).

## Export a ride as .tcx

Open a ride in the **Rides** tab, then click **⬇ Export .tcx**. The file contains second-by-second power, cadence, heart rate, speed, distance and altitude, in the Garmin Training Center format. It imports into Strava, TrainingPeaks and Garmin Connect. See [Backend and database](../developer-guide/backend-and-database.md#tcx-export).

## Delete a ride

Open the ride, click **🗑 Delete ride**, and confirm. Deleting is permanent.

## Rename yourself

Click **Rename** in the profile header, type your name in the box that opens, and confirm. Names are cut to 60 characters.

## Sign out

Click **Sign out** in the profile header. The page confirms *Signed out. Your rides are safe in your account.*

## Your data and privacy

- Only you can read your rides, settings, workouts, routes and FTP history.
- Admins see totals and the rider list (name, email, joined date, ride counts and feedback counts). They can't open your individual rides. See [Security](../developer-guide/security.md).
