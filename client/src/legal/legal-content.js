/**
 * KenganSocial Terms of Service, Privacy Policy and Data Deletion page, as structured content.
 * The React pages (/terms, /privacy, /data-deletion) render this, and scripts/build-legal.mjs
 * writes the same text as static HTML (client/public/legal, server/public/legal) so platform
 * reviewers and crawlers can read it without JavaScript. Edit here only.
 *
 * Blocks: { p: 'text' } | { ul: ['item', …] } | { table: { head: […], rows: [[…], …] } }.
 * Inline: [label](url) for links, **bold**.
 */
import { COMPANY, INFORMATION_REGULATOR, LEGAL_UPDATED, MISSING } from './company.js';

const c = COMPANY;
const or = (v) => v || MISSING;
const mail = (address) => `[${address}](mailto:${address})`;

const LINKS = {
    youtubeTerms: 'https://www.youtube.com/t/terms',
    googlePrivacy: 'https://policies.google.com/privacy',
    googleRevoke: 'https://security.google.com/settings/security/permissions',
    googleUserData: 'https://developers.google.com/terms/api-services-user-data-policy',
    metaTerms: 'https://www.facebook.com/terms.php',
    instagramTerms: 'https://help.instagram.com/581066165581870',
    metaPrivacy: 'https://www.facebook.com/privacy/policy/',
    tiktokTerms: 'https://www.tiktok.com/legal/page/global/terms-of-service/en',
    tiktokPrivacy: 'https://www.tiktok.com/legal/page/row/privacy-policy/en',
    tiktokMusic: 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en',
    tiktokBranded: 'https://www.tiktok.com/legal/page/global/bc-policy/en',
};

const contactLines = [
    `${c.legalName}${c.registrationNumber ? ` (registration number ${c.registrationNumber})` : ` (registration number ${MISSING})`}`,
    `Address: ${or(c.address)}`,
    `Information Officer: ${or(c.informationOfficer)}, ${mail(c.emails.privacy)}`,
    `General and support: ${mail(c.emails.general)}${c.phone ? `, ${c.phone}` : ''}`,
    `Billing: ${mail(c.emails.billing)}`,
];

export const TERMS = {
    id: 'terms',
    title: 'Terms of Service',
    updated: LEGAL_UPDATED,
    intro: `These terms are an agreement between you and ${c.legalName} ("${c.brand}", "we", "us") about your use of ${c.brand} at ${c.website} and its apps (the "Service"). By creating an account or using the Service you agree to them. If you use the Service for a business or client, you agree on its behalf and confirm you may do so.`,
    sections: [
        {
            id: 'service',
            heading: '1. What the Service does',
            blocks: [
                { p: `${c.brand} is a social media workspace for creators, businesses and agencies. With it you can:` },
                {
                    ul: [
                        'connect your Facebook Pages, Instagram professional accounts, TikTok accounts and YouTube channels;',
                        'create, edit and schedule videos and posts, and publish them to the accounts you connect;',
                        'see analytics for your connected accounts;',
                        'manage and answer Instagram direct messages, including automated replies that you set up;',
                        'use AI tools for captions, video editing, clips and marketing content.',
                    ],
                },
                { p: `${c.brand} is an independent product. It is **not affiliated with, endorsed or sponsored by** Meta Platforms, Inc. (Facebook, Instagram), TikTok or ByteDance, or Google LLC (YouTube). Their names are used only to describe the accounts you can connect.` },
            ],
        },
        {
            id: 'eligibility',
            heading: '2. Your account',
            blocks: [
                { ul: ['You must be at least 18 years old.', 'Give accurate information and keep your sign-in details secure. You are responsible for activity in your account and workspaces, including people you invite.', `Tell us straight away at ${mail(c.emails.support)} if you think your account has been used without permission.`] },
            ],
        },
        {
            id: 'connections',
            heading: '3. Connecting social accounts and acting on your behalf',
            blocks: [
                { p: 'When you connect a social account, you sign in with that platform and choose which permissions to grant. By connecting an account you authorise us to use those permissions **only to do what you ask in the Service**, for example to publish a post you created or scheduled, show its analytics, or send a reply you wrote or an automated reply you switched on. We never post, reply or change anything on your accounts without your instruction.' },
                { p: 'You can disconnect an account at any time under Dashboard › Connections. Disconnecting revokes our access at the platform and deletes the data that connection brought in (see our Privacy Policy). You can also remove our access in the platform’s own settings.' },
                { p: '**Platform terms.** Your use of each platform remains governed by that platform’s terms, which you agree to follow:' },
                {
                    ul: [
                        `**YouTube:** by using ${c.brand}’s YouTube features you agree to be bound by the [YouTube Terms of Service](${LINKS.youtubeTerms}). Google’s handling of your data is described in the [Google Privacy Policy](${LINKS.googlePrivacy}).`,
                        `**Facebook and Instagram:** the [Meta Terms of Service](${LINKS.metaTerms}) and [Instagram Terms of Use](${LINKS.instagramTerms}), including Meta’s messaging rules for automated replies.`,
                        `**TikTok:** the [TikTok Terms of Service](${LINKS.tiktokTerms}). When you post to TikTok you also agree to TikTok’s [Music Usage Confirmation](${LINKS.tiktokMusic}) and, for branded content, its [Branded Content Policy](${LINKS.tiktokBranded}).`,
                    ],
                },
                { p: 'Platforms can change or limit their services and APIs at any time. Some features may stop working or need you to reconnect, and we are not responsible for a platform’s decisions about your account or content.' },
            ],
        },
        {
            id: 'content',
            heading: '4. Your content',
            blocks: [
                { p: 'You keep ownership of everything you upload, create or publish ("your content"). You give us a limited licence to host, process, edit, transcribe and transmit your content only as needed to run the Service for you.' },
                { p: 'You confirm that you own your content or have every right needed to use and publish it, including music, footage, images and the likeness of people in it. Only import video from a link if it is your own content or you have permission to reuse it.' },
                { p: 'We do not use your content, or data from your connected accounts, to train AI models.' },
            ],
        },
        {
            id: 'messaging',
            heading: '5. Messaging, automation and marketing',
            blocks: [
                {
                    ul: [
                        'Automated replies and campaigns must follow the platform’s messaging rules (for example Meta’s 24-hour reply window) and South African law, including POPIA section 69 on direct marketing: only message people who agreed to hear from you or who are your existing customers, identify yourself, and stop immediately when someone opts out. The Service records opt-outs for you.',
                        'You are responsible for the messages sent from your accounts, including those sent by automations you set up.',
                    ],
                },
            ],
        },
        {
            id: 'ai',
            heading: '6. AI features',
            blocks: [
                { p: 'AI suggestions (captions, edits, replies, images) can be wrong or inappropriate. Review them before you publish or send them. You are responsible for what you publish.' },
            ],
        },
        {
            id: 'billing',
            heading: '7. Plans and payment',
            blocks: [
                {
                    ul: [
                        'Prices are shown on our Pricing page in South African rand and include VAT where applicable.',
                        'Payments are processed by Paystack. We never see or store your full card number.',
                        'Each payment covers the period you choose (a month or a year) and does not renew automatically. To keep a paid plan, pay again before the period ends; otherwise your workspace moves to the free plan.',
                        `Refunds are handled under the Consumer Protection Act and the Electronic Communications and Transactions Act where they apply. Contact ${mail(c.emails.billing)}.`,
                    ],
                },
            ],
        },
        {
            id: 'acceptable-use',
            heading: '8. Acceptable use',
            blocks: [
                { p: 'You may not use the Service to:' },
                {
                    ul: [
                        'break any law or any platform’s terms or community guidelines;',
                        'send spam or unsolicited messages, or buy, sell or fake followers, likes or engagement;',
                        'publish content you have no right to publish, or that is unlawful, hateful, harassing or deceptive;',
                        'scrape, harvest or build profiles of people from platform data;',
                        'access other people’s accounts or workspaces without permission, or try to break, overload or reverse engineer the Service.',
                    ],
                },
                { p: 'We may suspend features or accounts that break these rules, after telling you where we reasonably can.' },
            ],
        },
        {
            id: 'operator',
            heading: '9. Personal information of your contacts and clients',
            blocks: [
                { p: 'When you use the Service to process personal information of other people (for example people who message your Instagram account, leads, or an agency’s clients), you are the responsible party under POPIA and we act as your operator. We will process that information only on your instructions and for the Service, keep it confidential and secure, and tell you without undue delay if it is compromised.' },
            ],
        },
        {
            id: 'termination',
            heading: '10. Ending your account',
            blocks: [
                { p: 'You can delete your account at any time under Dashboard › Settings › Privacy & data › Delete account, or by emailing us. Deletion revokes your connected accounts and permanently deletes your workspaces and their data (details in the Privacy Policy). You can download a copy of your data first under Settings › Privacy & data › Download my data.' },
                { p: 'We may end the Service for an account that seriously or repeatedly breaks these terms.' },
            ],
        },
        {
            id: 'liability',
            heading: '11. Availability and liability',
            blocks: [
                { p: 'We work to keep the Service available and your data safe, but the Service is provided "as is". To the extent the law allows, we are not liable for indirect or consequential loss, lost profits or data, or for the actions of the platforms you connect, and our total liability is limited to the amount you paid us in the 12 months before the claim. Nothing in these terms limits rights you have under the Consumer Protection Act that cannot be limited.' },
            ],
        },
        {
            id: 'changes',
            heading: '12. Changes',
            blocks: [{ p: 'We may update these terms. We will tell you about important changes by email or in the app before they take effect. If you keep using the Service after that, the new terms apply.' }],
        },
        {
            id: 'law',
            heading: '13. Law and disputes',
            blocks: [{ p: `These terms are governed by the laws of ${c.jurisdiction}. Please contact us first so we can try to resolve any dispute. Disputes that cannot be resolved may be referred to ${c.disputeForum}, without affecting your right to approach a consumer tribunal or court where the law gives you that right.` }],
        },
        {
            id: 'contact',
            heading: '14. Contact',
            blocks: [{ ul: contactLines }],
        },
    ],
};

export const PRIVACY = {
    id: 'privacy',
    title: 'Privacy Policy',
    updated: LEGAL_UPDATED,
    intro: `This policy explains how ${c.legalName} ("${c.brand}", "we") collects, uses, shares and protects personal information when you use ${c.brand}, and the choices and rights you have. We are the responsible party under the Protection of Personal Information Act, 2013 (POPIA).`,
    sections: [
        {
            id: 'who',
            heading: '1. Who we are',
            blocks: [{ ul: contactLines }],
        },
        {
            id: 'collect',
            heading: '2. Information we collect',
            blocks: [
                { p: '**From you:** your name, email address and password (or Google sign-in), workspace and business details, your POPIA and marketing choices, the videos, images, music, captions and other content you upload or create, messages you write, and support requests.' },
                { p: '**From the social accounts you connect** (only after you sign in with that platform and approve the permissions it shows you):' },
                {
                    table: {
                        head: ['Platform', 'What we access', 'Why'],
                        rows: [
                            ['Facebook (Page)', 'Your Page ID, name, profile picture and follower count; a Page access token; your app-scoped Facebook user ID.', 'To publish the posts and videos you create or schedule to that Page, and show it in your workspace.'],
                            ['Instagram (professional account)', 'Your account ID, username and follower count; insights (reach, interactions, followers) and your recent posts’ captions, links and like/comment counts; direct messages sent to your account and the sender’s name, username and profile picture; opt-outs; access tokens; your app-scoped Facebook user ID.', 'To publish Reels you create or schedule, show analytics, and let you read and answer your DMs, including automated replies and lead capture you switch on.'],
                            ['TikTok', 'Your open ID, display name and avatar; posting options TikTok allows for your account (privacy levels, interaction settings, maximum video length); the status of posts you publish; access tokens.', 'To publish the videos you create, with the settings you choose on the post screen, and show which account you are posting to.'],
                            ['YouTube', 'Your channel ID, title, thumbnail and subscriber count; your video list and comments (shown live, not stored); channel analytics (views, likes, comments, shares, subscribers gained and lost); access tokens.', 'To upload the videos you create or schedule, list and manage your uploads, show comments and show analytics.'],
                        ],
                    },
                },
                { p: '**Automatically:** technical and security logs (IP address, browser, pages used, errors) and data your browser stores for the app to work: your sign-in session, and editor projects and media saved in your browser (IndexedDB) so your work is not lost. We do not use advertising cookies or third-party analytics trackers.' },
                { p: '**Payments:** Paystack processes your payment details; we receive your email, plan and a payment reference, never your full card number.' },
                { p: 'Giving us your account details is necessary to use the Service. Connecting social accounts and using AI or messaging features is voluntary; without them, those features do not work.' },
            ],
        },
        {
            id: 'use',
            heading: '3. How we use it, and why we may',
            blocks: [
                {
                    ul: [
                        'To provide the Service you asked for: publishing, scheduling, editing, analytics, messaging and AI tools (performing our contract with you).',
                        'To keep accounts and the Service secure, prevent abuse and fix problems (our legitimate interest, and legal obligations).',
                        'To process payments and keep tax records (contract and legal obligation).',
                        'To send service messages about your account. We send marketing emails only if you opted in, and every one has an unsubscribe link (POPIA section 69).',
                    ],
                },
                { p: 'We use information from connected accounts **only to provide the features you use** in your workspace. We do not sell it, use it for advertising, or use it to build profiles of people.' },
            ],
        },
        {
            id: 'ai',
            heading: '4. AI and automated processing',
            blocks: [
                { p: 'When you use an AI feature, we send the content needed for that task (for example a transcript, caption draft, image prompt or the text of a DM you want a reply for) to an AI provider listed below, which returns a result to you. Providers process it under their API terms. We do not use your content or data from connected accounts to train AI models, and we do not send data from connected accounts to AI providers except to perform a task you asked for.' },
                { p: 'Automated DM replies and keyword rules run only if you switch them on; you can review the inbox and switch them off at any time. We do not make decisions with legal or similarly significant effects about anyone based solely on automated processing.' },
            ],
        },
        {
            id: 'share',
            heading: '5. Who we share information with',
            blocks: [
                { p: 'We use these service providers (operators) to run the Service. They may process personal information only for us, under contracts that require them to keep it secure:' },
                {
                    ul: [
                        'Google Cloud and Firebase: sign-in, database (Firestore, Johannesburg region), file storage, servers, and Gemini AI.',
                        'Vercel: hosting of the website.',
                        'Paystack: payments.',
                        'OpenAI, OpenRouter, Perplexity and Pollinations: AI text, captions and images, when you use those features.',
                        'AssemblyAI: speech-to-text for captions, when enabled.',
                        'A Redis queue provider (job scheduling) and an S3-compatible storage provider (media files).',
                        'Pexels, Openverse, ccMixter and Audiomack: we send your search terms when you search their stock media or music; no personal information is sent.',
                    ],
                },
                { p: 'We also share information with the social platforms you connect, as needed to do what you ask (for example the video and caption you publish), with people you invite to your workspace, and where the law requires it. We never sell personal information.' },
            ],
        },
        {
            id: 'transfers',
            heading: '6. Transfers outside South Africa',
            blocks: [{ p: 'Some providers above, and the social platforms you connect, process information outside South Africa (for example in the United States and the European Union). We transfer it only where POPIA section 72 allows: the recipient is bound by law or a binding agreement that gives adequate protection, the transfer is needed to provide the Service you asked for, or you consent.' }],
        },
        {
            id: 'retention',
            heading: '7. How long we keep it',
            blocks: [
                {
                    ul: [
                        'Account and workspace data: while your account exists. When you delete your account it is deleted straight away, and removed from backups within 30 days.',
                        'Connected-account data: while the account is connected. When you disconnect, we revoke our access at the platform, delete the access tokens immediately, and delete the data that connection brought in (its stored analytics, and DMs, opt-outs and message leads for Instagram) within 7 days.',
                        'YouTube data is refreshed or deleted at least every 30 days. If you remove our access in your Google account, we delete your YouTube data within 30 days.',
                        'Analytics snapshots: 7, 30, 90 or 730 days depending on your plan (YouTube figures for at most 30 days).',
                        'Payment and tax records: as long as tax law requires (generally 5 years).',
                    ],
                },
            ],
        },
        {
            id: 'security',
            heading: '8. Security',
            blocks: [{ p: 'We protect information with encryption in transit (HTTPS) and at rest, encrypt social-account access tokens with AES-256-GCM, limit access to people who need it, and require sign-in for every workspace action. If a security compromise affects your information, we will tell you and the Information Regulator as POPIA section 22 requires.' }],
        },
        {
            id: 'rights',
            heading: '9. Your rights',
            blocks: [
                { p: 'Under POPIA you may ask to access, correct or delete your personal information, object to its processing, and withdraw consent you gave. You can:' },
                {
                    ul: [
                        'download all your data: Dashboard › Settings › Privacy & data › Download my data;',
                        'delete your account and data: Dashboard › Settings › Privacy & data › Delete account (see our [Data Deletion page](/data-deletion));',
                        'disconnect any social account: Dashboard › Connections;',
                        `or email our Information Officer at ${mail(c.emails.privacy)}. We respond within 30 days.`,
                    ],
                },
                { p: `You may complain to the ${INFORMATION_REGULATOR.name}: ${INFORMATION_REGULATOR.address}; ${mail(INFORMATION_REGULATOR.complaints)}; ${INFORMATION_REGULATOR.phone}; [${INFORMATION_REGULATOR.website.replace('https://', '')}](${INFORMATION_REGULATOR.website}).` },
                { p: c.paiaManualUrl ? `Our PAIA manual is available [here](${c.paiaManualUrl}).` : `Our PAIA manual is available on request from ${mail(c.emails.privacy)}.` },
            ],
        },
        {
            id: 'youtube',
            heading: '10. YouTube and Google',
            blocks: [
                { p: `${c.brand} uses **YouTube API Services**. By connecting YouTube you agree to the [YouTube Terms of Service](${LINKS.youtubeTerms}); Google’s use of your information is described in the [Google Privacy Policy](${LINKS.googlePrivacy}).` },
                { p: `We access, store and use YouTube data as described in sections 2, 3 and 7: your channel details, uploads, comments and analytics, only to show them in your workspace and to upload the videos you choose. We do not share YouTube data with third parties except our operators that host the Service.` },
                { p: `You can disconnect YouTube under Dashboard › Connections, and you can revoke ${c.brand}’s access at any time from your Google account’s [security settings](${LINKS.googleRevoke}).` },
                { p: `${c.brand}’s use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](${LINKS.googleUserData}), including the Limited Use requirements.` },
            ],
        },
        {
            id: 'meta',
            heading: '11. Facebook and Instagram',
            blocks: [
                { p: `We use Meta’s APIs as described in sections 2 and 3. Instagram direct messages are visible to people who manage your linked Facebook Page or Instagram account, and to members of your ${c.brand} workspace who can open the inbox.` },
                { p: `To delete the data we hold from Facebook or Instagram, disconnect the account under Dashboard › Connections, delete your ${c.brand} account, or remove ${c.brand} from your Facebook settings (Settings & privacy › Settings › Business integrations). When you remove it there, Meta tells us and we delete that data automatically; you can check the status on our [Data Deletion page](/data-deletion/status). Meta’s own handling of your data is described in the [Meta Privacy Policy](${LINKS.metaPrivacy}).` },
            ],
        },
        {
            id: 'tiktok',
            heading: '12. TikTok',
            blocks: [
                { p: `We use TikTok’s Login Kit and Content Posting API as described in sections 2 and 3. We keep your TikTok profile details and tokens only while TikTok is connected. Disconnecting revokes our access at TikTok and deletes them; you can also remove ${c.brand} in the TikTok app under Settings and privacy › Security › Manage app permissions. TikTok’s handling of your data is described in the [TikTok Privacy Policy](${LINKS.tiktokPrivacy}).` },
            ],
        },
        {
            id: 'children',
            heading: '13. Children',
            blocks: [{ p: `${c.brand} is for people aged 18 and over. We do not knowingly collect information from children. If you believe a child has given us information, contact us and we will delete it.` }],
        },
        {
            id: 'changes',
            heading: '14. Changes to this policy',
            blocks: [{ p: 'We will post any changes here with a new date, and tell you by email or in the app before important changes take effect. If a change means we would use information in a new way, we will ask for your consent first.' }],
        },
    ],
};

export const DATA_DELETION = {
    id: 'data-deletion',
    title: 'Data Deletion',
    updated: LEGAL_UPDATED,
    intro: `How to delete the data ${c.brand} holds about you, including data from Facebook, Instagram, TikTok and YouTube, and what happens when you do.`,
    sections: [
        {
            id: 'account',
            heading: 'Delete your whole account',
            blocks: [
                { ul: ['Sign in and open **Dashboard › Settings › Privacy & data**.', 'Optional: choose **Download my data** to keep a copy.', 'Choose **Delete account**, type DELETE and confirm.'] },
                { p: 'We immediately revoke every connected social account at its platform, then delete your workspaces, posts, media files, analytics, messages, leads and your sign-in. You receive a confirmation code you can look up below. Backups are cleared within 30 days.' },
            ],
        },
        {
            id: 'platform',
            heading: 'Delete the data from one platform',
            blocks: [
                { p: 'Open **Dashboard › Connections** and choose **Disconnect** on the account. We revoke our access at the platform, delete the access tokens straight away, and delete the data that connection brought in within 7 days.' },
                {
                    ul: [
                        `**Facebook or Instagram:** you can also remove ${c.brand} in Facebook under Settings & privacy › Settings › Business integrations. Meta notifies us and we delete your Facebook and Instagram data automatically.`,
                        `**YouTube:** you can also revoke access in your Google account’s [security settings](${LINKS.googleRevoke}). We then delete your YouTube data within 30 days.`,
                        `**TikTok:** you can also remove ${c.brand} in the TikTok app under Settings and privacy › Security › Manage app permissions.`,
                    ],
                },
            ],
        },
        {
            id: 'email',
            heading: 'Ask us by email',
            blocks: [{ p: `Email ${mail(c.emails.privacy)} from the address on your account with the subject "Delete my data". We confirm and complete the deletion within 30 days, and tell you if the law requires us to keep anything (for example tax records) and why.` }],
        },
    ],
};

export const POLICIES = { terms: TERMS, privacy: PRIVACY, 'data-deletion': DATA_DELETION };
