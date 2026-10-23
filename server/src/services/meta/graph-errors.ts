/**
 * Sorting Graph API errors from the send endpoints into what we do about them:
 *  - token:     the token was revoked or is invalid (code 190, and 102 session errors): the connection
 *               needs reconnecting, retrying is pointless;
 *  - window:    outside the messaging window (code 10 / subcode 2018278): permanent for this message;
 *  - retryable: rate limits (4, 17, 32, 613, 80006), temporary errors (1, 2, is_transient), 5xx and
 *               network errors: the webhook dispatcher retries with back-off;
 *  - permanent: anything else Meta refused (permissions, invalid recipient, policy): not retried.
 * https://developers.facebook.com/docs/graph-api/guides/error-handling
 */

export type GraphErrorKind = 'token' | 'window' | 'retryable' | 'permanent';

const TOKEN_CODES = new Set([190, 102]);
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80006]);

export interface GraphErrorInfo {
    kind: GraphErrorKind;
    code: number | null;
    subcode: number | null;
    message: string;
}

export function classifyGraphError(error: any): GraphErrorInfo {
    const meta = error?.response?.data?.error;
    const httpStatus = Number(error?.response?.status || 0);
    const code = meta?.code !== undefined ? Number(meta.code) : null;
    const subcode = meta?.error_subcode !== undefined ? Number(meta.error_subcode) : null;
    const message = String(meta?.message || error?.message || 'unknown error');
    if (!error?.response) return { kind: 'retryable', code, subcode, message }; // network error or timeout
    if (code !== null && TOKEN_CODES.has(code)) return { kind: 'token', code, subcode, message };
    if (subcode === 2018278) return { kind: 'window', code, subcode, message };
    if (meta?.is_transient === true || (code !== null && RETRYABLE_CODES.has(code))) return { kind: 'retryable', code, subcode, message };
    if (httpStatus >= 500 && code === null) return { kind: 'retryable', code, subcode, message };
    return { kind: 'permanent', code, subcode, message };
}
