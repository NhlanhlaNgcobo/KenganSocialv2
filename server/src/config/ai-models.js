/**
 * Model IDs in one place. Gemini versions are retired regularly, so the default is
 * Google's rolling "latest" alias; pin a version with GEMINI_MODEL if needed.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
