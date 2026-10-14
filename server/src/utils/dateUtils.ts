/**
 * Returns the current billing month key in YYYY-MM format (UTC).
 * Used as a suffix for Redis usage keys so counters scope to the month.
 */
export function getMonth(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Returns a Unix timestamp (seconds) for the last second of the current UTC month.
 * Used with redis.expireat() to auto-expire usage keys at billing reset.
 */
export function endOfMonth(): number {
    const now = new Date();
    // First day of next month at 00:00:00 UTC
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    return Math.floor(next.getTime() / 1000);
}
