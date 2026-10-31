// Neon: Managed Better Auth (sign in with Google / Apple) and the Data API.
// These URLs are public; each rider's rows are protected by row-level
// security in the database (see db/schema.sql).

import { createClient } from '@neon/neon-js';

const AUTH_URL =
  import.meta.env.VITE_NEON_AUTH_URL ?? 'https://ep-winter-voice-za03vb20.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
const DATA_API_URL =
  import.meta.env.VITE_NEON_DATA_API_URL ?? 'https://ep-winter-voice-za03vb20.apirest.c-2.eu-west-2.aws.neon.tech/neondb/rest/v1';

export const neon = createClient({
  auth: { url: AUTH_URL },
  dataApi: { url: DATA_API_URL },
});
