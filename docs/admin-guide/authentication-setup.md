# Authentication setup

This page covers setting up sign-in for the site with Neon Auth: trusted domains, Google, and Apple (Services ID, Team ID, Key ID, the `.p8` key and the return URL).

## Overview

Sign-in is handled by **Neon Auth**, which is managed Better Auth in the `americanflyers` Neon project. The app offers **Continue with Google** and **Continue with Apple**. The app's Neon client is in [`src/cloud/client.ts`](../../src/cloud/client.ts), and the sign-in logic is in [`src/cloud/account.ts`](../../src/cloud/account.ts).

Neon Auth's settings live in the **Neon Console**, under the project's **Auth** section. Work through the steps below in order.

## 1. Add trusted domains

Neon Auth only returns users to sites it trusts. Add each site URL the app runs on:

1. Open the project in the Neon Console, then **Auth → Trusted domains**.
2. Add the live site, for example `https://americanflyers.vercel.app`.
3. For local development, also add `http://localhost:5173`, the address `npm run dev` prints.

The app returns users to the page they signed in from, so each site's address needs to be on the list.

## 2. Google

Neon Auth provides Google sign-in. Open **Auth → OAuth providers** in the Neon Console and check the Google provider's settings.

Neon Auth can use its own shared Google credentials, or your own Google OAuth client. The repository doesn't record which option the project uses, so check the Google provider settings in the Neon Console before you change anything.

## 3. Apple

Apple needs your own Apple Developer credentials. In the Apple Developer portal, you need:

- a **Services ID** for sign-in,
- your **Team ID**,
- a **Key ID**, for a key with Sign in with Apple enabled, and
- the **`.p8`** private key file for that key.

Then, in the Neon Console, open **Auth → OAuth providers**, select Apple, and fill in:

| Field | Value |
| --- | --- |
| Services ID | Your Apple Services ID. |
| Team ID | Your Apple Team ID. |
| Key ID | The Key ID of your Sign in with Apple key. |
| Private key | The contents of your `.p8` file. Enter it in the Neon Console yourself. |
| Return URL | `https://ep-winter-voice-za03vb20.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth/callback/apple` |

Apple requires an HTTPS return URL. The return URL above is already HTTPS.

**Keep the `.p8` key private.** Enter it only in the Neon Console. Don't paste it into chat, a ticket, a commit or the repository, and don't put it in any file the app reads.

## 4. Check sign-in

1. Open the site in a browser where you haven't signed in.
2. Click **👤 Sign in**, then **Continue with Google** (and Apple, once set up).
3. Check you're returned to the same page, signed in, with your first name on the button.

If Apple sign-in isn't set up, the app shows *Sign in with Apple isn't switched on yet*. Google still works.

## Troubleshooting

- **Returned with an error.** The app shows *Sign-in didn't finish:* and the message from the provider. Check the trusted domains and provider settings.
- **Apple rejects the return URL.** Check the Services ID's return URL matches the one above exactly, including `/neondb/auth/callback/apple`.
- **Works on localhost but not on the live site (or the other way round).** Each address needs to be on the trusted domains list.

See [Troubleshooting](../user-guide/troubleshooting.md#sign-in-problems) for what riders see.
