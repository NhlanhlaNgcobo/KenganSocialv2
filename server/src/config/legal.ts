/**
 * Current versions of the Terms of Service and Privacy Policy (their effective dates).
 * Must equal TERMS.effectiveDate and PRIVACY.effectiveDate in client/src/content/legal.js;
 * scripts/build-legal-html.mjs refuses to build if they differ. Changing a version makes every
 * signed-in user accept the documents again (client: /consent, server: POST /api/auth/consent).
 */
export const LEGAL_VERSIONS = {
    terms: '23 October 2026',
    privacy: '23 October 2026',
} as const;

/** True when a user profile has accepted the current Terms and Privacy Policy. */
export function hasCurrentConsent(profile: any) {
    return profile?.legal?.termsVersion === LEGAL_VERSIONS.terms && profile?.legal?.privacyVersion === LEGAL_VERSIONS.privacy;
}
