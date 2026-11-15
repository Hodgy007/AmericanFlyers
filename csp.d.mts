export const NEON_DATA_API_ORIGIN: string;
export const SENTRY_INGEST: string[];
export const CSP_HEADER: string;
export const REPORT_PATH: string;
export const REPORT_GROUP: string;
export const REPORTING_HEADER: string;
export const REPORTING_VALUE: string;
export function inlineScriptHashes(html: string): string[];
export function buildCsp(html: string, options?: { dev?: boolean; dataApiOrigin?: string }): string;
