export const NEON_DATA_API_ORIGIN: string;
export const SENTRY_INGEST: string[];
export const CSP_HEADER: string;
export function inlineScriptHashes(html: string): string[];
export function buildCsp(html: string, options?: { dev?: boolean; dataApiOrigin?: string }): string;
