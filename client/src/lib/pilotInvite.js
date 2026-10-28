// An invite link (/login?invite=CODE) is remembered for the session until the invite form uses it.
const INVITE_KEY = 'kengan-invite';
try {
    const fromUrl = new URLSearchParams(window.location.search).get('invite');
    if (fromUrl) sessionStorage.setItem(INVITE_KEY, fromUrl);
} catch { /* no storage */ }

export const pendingInviteCode = () => { try { return sessionStorage.getItem(INVITE_KEY) || ''; } catch { return ''; } };
export const clearInviteCode = () => { try { sessionStorage.removeItem(INVITE_KEY); } catch { /* no storage */ } };
