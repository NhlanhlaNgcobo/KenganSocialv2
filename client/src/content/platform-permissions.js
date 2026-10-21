/**
 * What KenganSocial asks each platform for, in plain words, shown before the platform's own
 * consent screen (components/connections/ConnectPermissions.jsx). Keep each list in step with the
 * scopes requested in server/src/routes/connections.ts (OAUTH_CONFIG): reviewers compare them.
 */
export const PLATFORM_PERMISSIONS = {
    instagram: {
        name: 'Instagram',
        signInWith: 'Facebook',
        requirements: 'An Instagram professional (Business or Creator) account linked to a Facebook Page you manage. If you have several, you choose one after signing in.',
        asks: [
            ['Publish for you', 'Post the photos, videos and Reels you schedule in KenganSocial (instagram_content_publish).'],
            ['See your profile and results', 'Your username, profile picture, follower count and post insights (instagram_basic, instagram_manage_insights).'],
            ['Answer your messages', 'Show your direct messages in the Inbox and send the replies you write or automate, within 24 hours of each message (instagram_manage_messages).'],
            ['Show and answer comments', 'Show comments on your posts in the Inbox, post the replies you write or automate, and send one private reply to a commenter when you or your automation choose to (instagram_manage_comments).'],
            ['Find the linked Page', 'List the Facebook Pages you manage to find the one linked to your Instagram, and receive message notifications for it (pages_show_list, pages_read_engagement, pages_manage_metadata, business_management).'],
        ],
    },
    facebook: {
        name: 'Facebook Page',
        signInWith: 'Facebook',
        requirements: 'A Facebook Page where you have a role that allows posting. If you manage several, you choose one after signing in.',
        asks: [
            ['Publish for you', 'Post the content you schedule to your Page (pages_manage_posts).'],
            ['Show and answer comments', "Read comments on your Page's posts and post the replies you write or automate (pages_read_user_content, pages_manage_engagement)."],
            ['Answer Messenger messages', 'Show messages sent to your Page in the Inbox and send your replies, within 24 hours of each message (pages_messaging).'],
            ['See your Page and results', 'Your Page name, picture, followers and engagement, and receive notifications for new comments and messages (pages_show_list, pages_read_engagement, pages_manage_metadata, business_management).'],
        ],
    },
    meta_ads: {
        name: 'Meta Ads',
        signInWith: 'Facebook',
        requirements: 'A Meta ad account you can access in Ads Manager. If you have several, you choose one after signing in.',
        asks: [
            ['See your campaigns and results', 'List the campaigns in the ad account you choose, with spend, reach, clicks and results (ads_read).'],
            ['Make the changes you ask for', 'Pause or resume a campaign, or change its daily budget, only when you do it on the Ads page. Each change is recorded (ads_management).'],
        ],
    },
    tiktok: {
        name: 'TikTok',
        signInWith: 'TikTok',
        requirements: 'Any TikTok account.',
        asks: [
            ['Know which account is yours', 'Your TikTok display name and avatar (user.info.basic).'],
            ['Send videos to TikTok', 'Upload the videos you schedule. Until TikTok approves direct posting for KenganSocial, they arrive in your TikTok inbox for you to finish and post (video.upload).'],
        ],
    },
    youtube: {
        name: 'YouTube',
        signInWith: 'Google',
        requirements: 'A Google account with a YouTube channel.',
        asks: [
            ['Upload for you', 'Upload the videos you schedule, with the title, description and visibility you choose (youtube.upload).'],
            ['See your channel', 'Your channel name, picture, subscriber count, and your videos and their statistics (youtube.readonly).'],
            ['Manage comments and videos', "Show comments on your videos, post your replies, and delete a video only when you ask (youtube.force-ssl)."],
            ['See your channel analytics', 'Views, likes, comments, shares and subscribers gained or lost, for the Analytics page (yt-analytics.readonly).'],
        ],
    },
};

export const NEVER = [
    'Post, reply or spend money without your instruction or an automation you switched on.',
    'Sell your data or use it for advertising.',
    'Use your content, account data or messages to train AI.',
];
