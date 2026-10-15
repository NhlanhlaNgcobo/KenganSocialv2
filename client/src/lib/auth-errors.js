/** Plain-language messages for Firebase Auth errors shown on the sign-in and sign-up forms. */
const MESSAGES = {
    'auth/invalid-credential': 'That email and password do not match. Check them and try again.',
    'auth/wrong-password': 'That email and password do not match. Check them and try again.',
    'auth/user-not-found': 'There is no account with that email. Create one instead.',
    'auth/invalid-email': 'That email address does not look right.',
    'auth/email-already-in-use': 'An account with that email already exists. Log in instead.',
    'auth/weak-password': 'Use a password of at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes, or reset your password.',
    'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
    'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
    'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
    'auth/user-disabled': 'This account has been disabled. Contact support.',
};

export function authErrorMessage(err, fallback = 'Something went wrong. Try again.') {
    const code = err?.code || err?.message?.match(/\((auth\/[^)]+)\)/)?.[1];
    return MESSAGES[code] || (err?.message && !/^Firebase:/.test(err.message) ? err.message : fallback);
}
