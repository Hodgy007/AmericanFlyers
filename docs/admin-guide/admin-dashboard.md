# Admin dashboard

This page describes every tile, chart, table and action on the admin dashboard, including how banning works and how to work through the feedback inbox.

## Who sees the dashboard

The **🛠 Admin** button appears in the top bar only for admin accounts. Admin access is decided in the database, not in the browser, so the button is a convenience. Every admin action is checked again on the server. See [Managing admins](managing-admins.md).

Click **🛠 Admin** to open the profile dialog on its **🛠 Admin** tab. The tab shows *Updated* with the time it loaded. Click **↻ Refresh** to reload everything.

## Overview tiles

The first set of tiles summarizes the whole site.

| Tile | Shows | Notes |
| --- | --- | --- |
| **Registered riders** | Total accounts | Underneath: new accounts in the last 7 days and the last 30 days. |
| **Active riders** | Riders with at least one ride in the last 7 days | Underneath: riders active in the last 30 days. |
| **Rides saved** | Total saved rides | Underneath: rides saved in the last 7 days. |
| **Hours ridden** | Sum of all ride durations, in hours | Rounded to the nearest hour. |
| **Distance** | Sum of all ride distances, in km | Rounded to the nearest km. |
| **Climbed** | Sum of all climbing, in meters | |
| **Workouts / routes saved** | Count of saved workouts, then saved routes | These count rows in the database, so they include riders' saved copies. |
| **Feedback** | New feedback items | Underneath: total feedback items. |
| **Banned** | Accounts currently banned | |

## Charts

- **New riders per day, last 30 days:** one bar per day, with a label every seven days.
- **Rides per day, last 30 days:** one bar per day, with a label every seven days.

Hover a bar to see its date and count. Days with no activity show an empty bar.

## Top stages and top workouts

- **Top stages** lists up to eight stages by number of rides, with the number of riders and finishes. Rides on Heartland Rollers and on uploaded GPX routes count under their stage name.
- **Top workouts** lists up to eight workouts by number of rides, with the number of riders.

If nothing has been recorded, the table says *None yet*.

## Riders

The rider list shows every account, newest first, with a count in the heading.

| Column | Meaning |
| --- | --- |
| Name, Email | The account's details. |
| Joined | The date the account was created. |
| Rides, Hours, km | Totals across the rider's saved rides. |
| Last ride | The date of the most recent ride. |
| Feedback | How many feedback items the rider has sent. |
| Status | **Admin**, **Banned** or **Active**. |
| (action) | **Ban** or **Unban**. |

Type in the search box to filter by name or email.

### Ban and unban

Click **Ban** on a rider:

1. A prompt asks you to confirm, and offers an optional reason. Cancel to stop.
2. The rider is marked banned, and their current sign-in sessions are removed, so they're signed out.
3. The row changes to **Banned**, and the button becomes **Unban**.

The dialog tells the rider they can't sign in again. That depends on Neon Auth honoring the banned flag on the account, which the database sets. Test this with a non-admin account before relying on it.

**Unban** clears the banned flag. It doesn't restore sessions, so the rider signs in again.

**What you can't ban:**

- **Yourself.** The database refuses it with *You can't ban yourself*.
- **Other admins.** The dashboard doesn't show **Ban** on admin rows. This is a dashboard rule only: the database function doesn't refuse banning an admin account. Don't rely on the dashboard to protect an admin from another admin's action.

A banned admin loses admin access, because admin checks also require the account not to be banned. See [Managing admins](managing-admins.md#how-admin-access-works).

## Feedback inbox

The inbox lists feedback from riders, with the newest and still-open items first. Use the filter above it to choose:

- **Open (new, planned, in progress):** the default, for work that still needs doing.
- **All**, or one status: **New**, **Planned**, **In progress**, **Done** or **Declined**.

Each item shows its type (💡 Idea, 🐞 Bug or 💬 Other), the rider's name and email, the time sent, the message, and the context the app attached (stage, workout, trainer, browser, screen size and version).

### Work through an item

1. Read the message and context.
2. Pick a **status**.
3. Write a **reply** (up to 2,000 characters). The rider sees it under their suggestion.
4. Click **Save**. The card updates, and the item moves in the filter as its status changes.
5. For spam or junk, click **Delete** and confirm. Deleting is permanent.

Admins can't change a message or its type. A database trigger keeps riders' original wording intact. See [Security](../developer-guide/security.md).

The inbox loads up to 500 items, with new ones first. Anything beyond that isn't listed.

## Refreshing

Everything loads when you open the Admin tab. Use **↻ Refresh** after changes you've made elsewhere, such as in the Neon console.
