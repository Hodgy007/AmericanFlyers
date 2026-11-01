// Neon: Managed Better Auth (sign in with Google, or email and password) and the Data API.
// These URLs are public; each rider's rows are protected by row-level
// security in the database (see db/schema.sql).
//
// The SDK is ~190 kB, and nothing on the first frame needs it, so it loads on
// demand (a vendor chunk of its own). `neon` below looks and chains exactly
// like the real client (`neon.from('x').select().eq(...)`, `neon.rpc(...)`,
// `neon.auth.getSession()`), but it only records the calls; awaiting the result
// loads the SDK, builds the client, replays the calls on it and awaits that.
// Nothing outside this file needs to know.

import type { createClient } from '@neon/neon-js';

const AUTH_URL =
  import.meta.env.VITE_NEON_AUTH_URL ?? 'https://ep-winter-voice-za03vb20.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
const DATA_API_URL =
  import.meta.env.VITE_NEON_DATA_API_URL ?? 'https://ep-winter-voice-za03vb20.apirest.c-2.eu-west-2.aws.neon.tech/neondb/rest/v1';

const build = (make: typeof createClient) => make({ auth: { url: AUTH_URL }, dataApi: { url: DATA_API_URL } });
type NeonClient = ReturnType<typeof build>;

let real: Promise<NeonClient> | null = null;

/** The real client, built the first time something needs it. */
export function realNeon(): Promise<NeonClient> {
  real ??= import('@neon/neon-js').then(({ createClient: make }) => build(make)).catch((e) => { real = null; throw e; });
  return real;
}

/** Starts loading the SDK without using it yet. */
export function warmNeon() {
  realNeon().catch(() => {});
}

type Step = { get: string | symbol } | { call: unknown[] };

/** A not-yet-run chain such as `neon.from('rides').select('*').eq('id', 1)`. */
function chain(steps: Step[]): unknown {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        // Awaited: run the whole chain on the real client.
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          realNeon().then((client) => {
            let cursor: unknown = client;
            let owner: unknown = client;
            for (const step of steps) {
              if ('get' in step) { owner = cursor; cursor = (cursor as Record<string | symbol, unknown>)[step.get]; }
              else cursor = Reflect.apply(cursor as (...a: unknown[]) => unknown, owner, step.call); // not cursor.apply(): the SDK's own proxies answer `.apply` as an API path
            }
            return cursor;
          }).then(resolve, reject);
      }
      if (typeof prop === 'symbol') return undefined;
      return chain([...steps, { get: prop }]);
    },
    apply(_t, _this, args) {
      return chain([...steps, { call: args }]);
    },
  });
}

export const neon = chain([]) as unknown as NeonClient;
