# Authentication setup

This page covers sign-in for the site with Neon Auth: trusted domains, Google, and email and password (sign-up, sign-in and password reset).

## Overview

Sign-in is handled by **Neon Auth**, which is managed Better Auth in the `americanflyers` Neon project. Riders can:

- **Continue with Google**, or
- **Create an account with email**: a rider name, email, password (8+ characters), weight, and FTP if they know it. No phone number or address is ever asked for.

The app's Neon client is in [`src/cloud/client.ts`](../../src/cloud/client.ts), the sign-in calls are in [`src/cloud/account.ts`](../../src/cloud/account.ts), and the email form is [`src/cloud/emailAuth.ts`](../../src/cloud/emailAuth.ts).

Neon Auth's settings live in the **Neon Console**, under the project's branch **Settings → Auth**.

Sign in with Apple was removed: it needs a paid Apple Developer membership.

## 1. Trusted domains

Neon Auth only returns users to sites it trusts. The list currently holds:

- `https://americanflyers.vercel.app` (the live site)
- `http://localhost:5173` (`npm run dev`)
- `http://localhost:4173` (`npm run preview`)

Add any new domain (for example a custom domain) under **Auth → Trusted domains** before riders use it.

## 2. Google

Google sign-in uses Neon's **shared** Google credentials. That works, but Google's consent screen shows Neon's name rather than American Flyers. To show your own name and logo, create a Google OAuth client (Web application) with the redirect URI `https://ep-winter-voice-za03vb20.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth/callback/google`, then add its Client ID and secret under **Auth → OAuth providers → Google**. See Neon's [Set up OAuth](https://neon.com/docs/auth/guides/setup-oauth) guide.

## 3. Email and password

These are the current settings (Neon Console → **Auth**):

| Setting | Value | Why |
| --- | --- | --- |
| Email and password | On | Riders can create accounts without Google. |
| Allow sign-up | On | |
| Verify email on sign-up | Off | No code to type in; riders start riding straight away. See [Turning on email verification](#turning-on-email-verification). |
| App name | *American Flyers* | Shown in password reset emails. |
| Email sender | Neon's shared sender (`auth@mail.myneon.app`) | Fine to start with. For better delivery, add your own email provider in the Neon Console. |

### Password reset

**Forgot password?** on the sign-in form emails a link that's valid for 15 minutes. The link returns to the site with `?token=…`, the app opens **Set a new password**, and then asks the rider to sign in with the new password.

### Turning on email verification

The app already has the verification step (a 6-digit code), so this can be switched on without a new deploy. In the Neon Console go to the project's branch **Settings → Auth → Email and password** and set:

| Setting | Value | Effect |
| --- | --- | --- |
| Verify email on sign-up (`verify_email_on_sign_up`) | On | Neon emails a 6-digit code when someone signs up. |
| Verification method (`email_verification_method`) | Verification code (`otp`; already the current value) | Codes, not links. Links need your own email provider. |
| Require email verification (`require_email_verification`) | On | The account isn't signed in until the code is entered, so the app shows the code box after sign-up. If you leave this Off, riders are signed in at once and only see the "Verify your email" banner in their profile. |
| Verify email on sign-in (`verify_email_on_sign_in`) | On | An existing unverified account that signs in is emailed a code, and the app shows the code box. |
| Auto sign in after verification (`auto_sign_in_after_verification`) | On (already) | The rider is signed in as soon as the code is right. |

With the CLI: `neon neon-auth config email-password update --enabled --require-email-verification`. The same settings are in the API's *Update email and password configuration* endpoint.

Things to know before switching it on:

- **Existing email accounts are unverified.** With "Require" on, they can't sign in until they enter a code; the app asks for it and Neon sends it (that is why "Verify on sign-in" should be On). Google accounts are already verified.
- Codes last 15 minutes and are rate limited. Neon's shared sender (`auth@mail.myneon.app`) has low limits, so add your own email provider first for real use (see Neon's [production checklist](https://neon.com/docs/auth/production-checklist#email-provider)).
- Test with a new address: sign up, check the email, enter the code. Then sign out and sign back in.
- The app works the same with everything Off: no code step is shown.

Admins need a verified email (see [Managing admins](managing-admins.md)). Google accounts are verified; email accounts aren't while verification is off.

## 4. Check sign-in

1. Open the site in a private window.
2. Try **Continue with Google**: you should come back signed in, with your first name on the 👤 button.
3. Sign out, then **Sign up with email** with a new address. You should be signed in straight away, with the weight and FTP you entered in ⚙ Settings.
4. Sign out and sign back in with that email and password.
5. Try **Forgot password?**, follow the email link, and set a new password.

## Troubleshooting

- **Returned with an error.** The app shows *Sign-in didn't finish:* and the message from Google. Check the trusted domains.
- **"There's already an account with this email."** That address has an account (maybe made with Google). Sign in instead, or use **Forgot password?**.
- **No reset email.** Check spam. The shared sender is rate-limited; set up your own email provider for production.
- **Works on localhost but not on the live site (or the other way round).** Each address needs to be on the trusted domains list.

See [Troubleshooting](../user-guide/troubleshooting.md#sign-in-problems) for what riders see.
