/**
 * YouTube Utility functions (Simulation)
 */

export const getYouTubeAuthUrl = () => {
    // In a real app, this would generate a Google OAuth URL
    return 'https://accounts.google.com/o/oauth2/v2/auth?client_id=MOCK_ID&redirect_uri=MOCK_URI&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload';
};

export const verifyYouTubeTokens = async (code) => {
    // Simulate token verification
    return {
        accessToken: 'mock_youtube_access_token_' + Date.now(),
        refreshToken: 'mock_youtube_refresh_token',
        expiresIn: 3600,
        profile: {
            id: 'UC' + Math.random().toString(36).substring(2, 12),
            title: 'Kengan Creator',
            thumbnails: { default: { url: 'https://via.placeholder.com/150' } }
        }
    };
};
