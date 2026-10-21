/**
 * Legal documents: the single source for the in-app pages (pages/LegalPage.jsx) and the static
 * pages platform reviewers fetch (scripts/build-legal-html.mjs → client/public and server/public).
 * Plain JS with no imports, so Node can load it too. After editing, run:
 *   node scripts/build-legal-html.mjs
 */

export const COMPANY = {
    product: 'KenganSocial',
    operator: 'MiraiStack',
    operatorSite: 'https://www.miraistack.co.za',
    registration: 'K2025971590',
    site: 'https://kengansocial.co.za',
    privacyEmail: 'privacy@kengansocial.co.za',
    supportEmail: 'support@kengansocial.co.za',
    billingEmail: 'billing@kengansocial.co.za',
    // Where the company is based, shown on public pages and in the legal documents. The registration
    // number appears only in the legal documents (Terms, Privacy Policy, Data deletion).
    address: 'Durban, KwaZulu-Natal, South Africa',
};

const OPERATOR_LINE = `${COMPANY.product} is operated by ${COMPANY.operator} (registration number ${COMPANY.registration}), a company registered in the Republic of South Africa${COMPANY.address ? ` and based in ${COMPANY.address}` : ''}.`;

const EFFECTIVE = '20 October 2026';

export const PRIVACY = {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: `How ${COMPANY.product} collects, uses, shares and deletes personal information, including data from the social accounts you connect. Written to meet POPIA and the requirements of Meta, TikTok and Google.`,
    effectiveDate: EFFECTIVE,
    lastUpdated: EFFECTIVE,
    sections: [
        {
            id: 'who-we-are',
            heading: 'Who we are',
            content: `${OPERATOR_LINE}

${COMPANY.operator} is the responsible party for personal information processed through ${COMPANY.product} (${COMPANY.site}), as defined in the Protection of Personal Information Act 4 of 2013 (POPIA).

When you use ${COMPANY.product} to manage your social media accounts and your audience's messages, you decide why and how that audience data is used, and ${COMPANY.operator} processes it on your behalf as an operator under POPIA.

Information Officer: ${COMPANY.privacyEmail}`,
        },
        {
            id: 'what-we-collect',
            heading: 'Information we collect',
            content: `Account information: your name, email address, password (handled by Google Firebase Authentication; we never see it), profile photo if you sign in with Google, workspace name, industry, and the consent records you accept during onboarding.

Content you create: videos, images, audio, captions, drafts, schedules, automation rules and reply templates you upload or write in ${COMPANY.product}.

Connected account information: when you connect a social account, we receive an access token and the account details described in "Data from connected platforms" below. Tokens are encrypted before they are stored.

Information about other people: if you turn on comment or message automation, we receive the comments and direct messages people send to your connected accounts, with their public name, username, profile picture and platform user ID, so that we can show them in your Inbox and reply on your behalf.

Billing information: your plan and payment status. Card payments are handled by Paystack; we do not receive or store card numbers.

Technical information: IP address, browser type, device type, pages used and error logs, kept to run, secure and fix the service.`,
        },
        {
            id: 'platform-data',
            heading: 'Data from connected platforms',
            content: `We only request the permissions a feature you use needs, and we only use platform data to provide that feature to you.

Instagram (Meta): your professional account's ID, username, profile picture and follower count; the posts and Reels you publish through us; comments on your posts; direct messages sent to your account; and account insights. Used to publish and schedule your posts, show your comments and messages in the Inbox, send the replies and automated responses you set up, and show your analytics.

Facebook Pages (Meta): the Pages you choose to connect, with their name, picture and follower count; posts you publish through us; comments on your Page's posts; Messenger conversations with your Page; and Page insights. Used for the same purposes as Instagram.

Meta Ads: the ad accounts you choose to connect, with their campaigns, ad sets, ads, budgets and performance results. Used to show your ad results and, only when you confirm an action, to create, pause or edit campaigns and budgets. We never spend money or change an ad without your explicit confirmation in ${COMPANY.product}.

TikTok: your TikTok open ID, display name and avatar; the videos you publish through us and their publishing status; and, for TikTok Business accounts you connect for automation, comments on your videos and direct messages sent to your account. Used to publish your videos, show their status, and reply to comments and messages as you set up.

YouTube: your channel's ID, name, thumbnail and subscriber count; the videos you upload through us; your channel's video list and statistics; and comments on your videos. Used to upload and schedule videos, show your videos and analytics, and reply to comments.

What we never do with platform data: we do not sell it; we do not use it for advertising, profiling or to build audience lists for anyone else; we do not use it to train or improve artificial intelligence models; and we do not share it with other customers. Each workspace's data is kept separate from every other workspace.`,
        },
        {
            id: 'youtube',
            heading: 'YouTube API Services',
            content: `${COMPANY.product} uses YouTube API Services. By connecting a YouTube channel you agree to be bound by the YouTube Terms of Service (https://www.youtube.com/t/terms). Google's Privacy Policy (https://policies.google.com/privacy) describes how Google handles your information.

You can revoke ${COMPANY.product}'s access to your Google account at any time at https://myaccount.google.com/permissions, or by disconnecting YouTube on the Connections page. When access is revoked, we delete the YouTube data we stored within 7 days.

Google API Services User Data Policy: ${COMPANY.product}'s use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. We do not transfer Google user data to others except as needed to provide the features you use, to comply with the law, or as part of a merger with your notice; we do not use it for advertising; and we do not let people read it unless you ask us to (for support), it is needed for security or the law, or it has been aggregated and anonymised.`,
        },
        {
            id: 'how-we-use',
            heading: 'How we use information',
            content: `To provide the service: create your account and workspaces, publish and schedule your content, run the automations you configure, show your Inbox and analytics, edit and render your videos, and process payments.

To keep it working and safe: prevent abuse and unauthorised access, enforce platform rate limits, fix errors and keep records the law requires.

To communicate with you: service notices about your account, posts, connections and billing. Marketing emails are sent only with your consent, and you can withdraw consent at any time.

We do not use your content, your connected account data or your audience's messages to train AI models, and we do not make automated decisions about you that have legal or similarly significant effects.`,
        },
        {
            id: 'ai',
            heading: 'Artificial intelligence features',
            content: `Some features send content to an AI provider to produce a result for you: writing captions and posts, suggesting or sending replies to comments and messages you have set to automate, transcribing and finding highlights in your videos, and creating images.

Only the content needed for the request is sent (for example, the text of one message and your reply instructions). Providers process it to return the result and, under their API terms, do not use it to train their models. AI-written replies are only sent automatically when you have switched that automation on; otherwise they wait in your Inbox for approval.

AI providers we use: OpenRouter (which routes requests to model providers such as Anthropic), OpenAI, Google (Gemini), Perplexity (trend research, without your account data), Pollinations (image generation) and AssemblyAI (transcription).`,
        },
        {
            id: 'sharing',
            heading: 'Who we share information with',
            content: `Service providers who process data for us under contract: Google Cloud and Firebase (sign-in, database and file storage), our cloud hosting and file storage provider, Paystack (payments), Redis hosting (job queues), and the AI providers listed above.

Social platforms: when you publish, reply or change an ad, we send that content or instruction to the platform you chose. The platform's own terms and privacy policy then apply.

Your workspace: members you invite to your workspace, and clients you share a review link with, can see the content you give them access to.

The law: when we are legally required to, for example by a court order, or to protect people from harm or fraud.

Business transfer: if ${COMPANY.operator} is merged or sold, information may transfer to the new owner, who must keep this policy's protections. We will tell you first.

We never sell personal information.`,
        },
        {
            id: 'security',
            heading: 'How we protect information',
            content: `Access tokens for connected accounts are encrypted with AES-256-GCM before storage and are only decrypted on our servers when needed to act for you. They are never sent to your browser.

Data is sent over HTTPS. Each request is checked so that one workspace can never read or change another workspace's data, and messages from platforms are verified with their signatures before we process them.

Access to production systems is limited to people who need it. If a breach affects your personal information, we will notify you and the Information Regulator as POPIA section 22 requires.`,
        },
        {
            id: 'transfers',
            heading: 'International transfers',
            content: `Some of our service providers store or process data outside South Africa, including in the United States and the European Union. We only use providers that are bound by data protection laws or contractual terms giving protection comparable to POPIA, as section 72 of POPIA requires.`,
        },
        {
            id: 'retention',
            heading: 'How long we keep information',
            content: `Connected account tokens: until you disconnect the account, or the platform tells us (or shows us, by refusing access) that you removed ${COMPANY.product}. Then they are deleted immediately.

Data fetched from a connected account (messages, comments, profile details, analytics): deleted within 7 days after that account is disconnected or its access is revoked.

Your account and workspace content: kept while your account is active, and deleted within 30 days after you delete your workspace or account.

Billing records: 5 years, as South African tax law requires.

Security and error logs: up to 12 months.`,
        },
        {
            id: 'deletion',
            heading: 'Deleting your data and revoking access',
            content: `Disconnect one account: Connections page → the account → Disconnect. We revoke our access with the platform where it allows this, delete the token at once, and delete that account's stored data within 7 days.

Delete your whole account: Settings → Delete account. This removes your workspaces, content, connections and automations.

Remove ${COMPANY.product} on the platform itself:
— Facebook: Settings & privacy → Settings → Business integrations (https://www.facebook.com/settings?tab=business_tools), then remove ${COMPANY.product}.
— Instagram: Settings → Apps and websites (https://www.instagram.com/accounts/manage_access/), then remove ${COMPANY.product}.
— TikTok: Settings and privacy → Security → Manage app permissions, then remove ${COMPANY.product}.
— Google / YouTube: https://myaccount.google.com/permissions, then remove ${COMPANY.product}.

When you remove us on Facebook or Instagram, Meta notifies us automatically and we delete your data and give you a confirmation code you can check on our data deletion page (${COMPANY.site}/data-deletion).

Full instructions, including for people who are not ${COMPANY.product} users but have messaged or commented on a ${COMPANY.product} customer's account: ${COMPANY.site}/data-deletion`,
        },
        {
            id: 'rights',
            heading: 'Your rights',
            content: `Under POPIA you may ask to see the personal information we hold about you, ask us to correct or delete it, object to its processing, and withdraw consent you have given. Email ${COMPANY.privacyEmail}; we reply within 30 days and may first need to confirm your identity.

You may also complain to the Information Regulator of South Africa: https://inforegulator.org.za, complaints.IR@inforegulator.org.za.

If you live in the European Union, the United Kingdom or California, you have similar rights under the GDPR, UK GDPR or CCPA, and can use the same email address to exercise them.`,
        },
        {
            id: 'cookies',
            heading: 'Cookies and local storage',
            content: `We use only what is needed to keep you signed in and remember your preferences (for example, your theme and editor layout), stored in your browser's local storage by Firebase Authentication and our app. We do not use advertising or cross-site tracking cookies.`,
        },
        {
            id: 'children',
            heading: 'Children',
            content: `${COMPANY.product} is for people aged 18 and older. We do not knowingly collect personal information from children. If you believe a child has given us personal information, email ${COMPANY.privacyEmail} and we will delete it.`,
        },
        {
            id: 'changes',
            heading: 'Changes to this policy',
            content: `If we make a material change, we will email account owners and show a notice in the app at least 30 days before it takes effect. The date at the top shows when this policy last changed.`,
        },
        {
            id: 'contact',
            heading: 'Contact',
            content: `${COMPANY.operator}, operator of ${COMPANY.product}
Registration number: ${COMPANY.registration}${COMPANY.address ? `\nAddress: ${COMPANY.address}` : ''}
Privacy and the Information Officer: ${COMPANY.privacyEmail}
Support: ${COMPANY.supportEmail}
Website: ${COMPANY.site}`,
        },
    ],
};

export const TERMS = {
    slug: 'terms',
    title: 'Terms of Service',
    summary: `The agreement between you and ${COMPANY.operator} for using ${COMPANY.product}. Governed by the laws of the Republic of South Africa.`,
    effectiveDate: EFFECTIVE,
    lastUpdated: EFFECTIVE,
    sections: [
        {
            id: 'agreement',
            heading: 'About these terms',
            content: `${OPERATOR_LINE} These Terms of Service ("Terms") are an agreement between you and ${COMPANY.operator} ("we", "us") for your use of ${COMPANY.product} at ${COMPANY.site} (the "Platform").

By creating an account you accept these Terms and our Privacy Policy (${COMPANY.site}/privacy). If you accept them for a business or a client, you confirm you are authorised to bind them.`,
        },
        {
            id: 'service',
            heading: 'The service',
            content: `${COMPANY.product} helps creators, businesses and agencies to:
— connect Instagram, Facebook Pages, Meta ad accounts, TikTok and YouTube accounts;
— create, edit, publish and schedule posts and videos;
— reply to comments and direct messages, by hand or with automations they configure;
— view analytics and ad results, and manage ad campaigns they confirm;
— work with team members and clients in shared workspaces.

Some features depend on the social platforms' APIs, which they can change or limit. We are not responsible for a platform's changes, outages or decisions, but we will tell you when a feature is affected.`,
        },
        {
            id: 'accounts',
            heading: 'Your account',
            content: `You must be at least 18, give accurate information, and keep your login secure. You are responsible for activity in your account and workspaces, including by members you invite.

Tell us at once at ${COMPANY.supportEmail} if you suspect unauthorised access. Creating several accounts to avoid plan limits is not allowed.`,
        },
        {
            id: 'connected-accounts',
            heading: 'Connected social accounts',
            content: `You may only connect accounts, Pages and ad accounts that you own or are authorised to manage. When you connect one, you authorise us to act on it as the features you use require, for example to publish the content you schedule or send the replies your automations produce.

You must follow each platform's rules when you use ${COMPANY.product}, including the Meta Platform Terms and Community Standards, the TikTok Terms of Service and Community Guidelines, and the YouTube Terms of Service (https://www.youtube.com/t/terms). By connecting YouTube you agree to the YouTube Terms of Service.

You can disconnect an account at any time on the Connections page.`,
        },
        {
            id: 'automation-rules',
            heading: 'Messaging and automation rules',
            content: `Automations must only reply to people who have contacted you first, within the reply windows the platforms set (for example, Meta allows replies within 24 hours of a person's last message, and TikTok within 48 hours). ${COMPANY.product} enforces these windows.

You must not use ${COMPANY.product} to send spam or unsolicited bulk messages, to mislead people about who they are talking to, to collect sensitive information without consent, or to message people who asked you to stop. When someone replies STOP or a similar opt-out word, automations stop messaging them.

You are responsible for the content of your replies and templates, including AI-written replies you allow to send automatically.`,
        },
        {
            id: 'ads',
            heading: 'Meta ads',
            content: `If you connect a Meta ad account, ${COMPANY.product} will only create, edit or pause campaigns, ad sets, ads or budgets after you confirm the action. You remain the advertiser: you are responsible for your ads' content, targeting and compliance with Meta's Advertising Standards, and for all ad spend, which Meta bills to you directly. We are not liable for ad spend or ad results.`,
        },
        {
            id: 'acceptable-use',
            heading: 'Acceptable use',
            content: `You must not use the Platform to:
— break any law or anyone's rights, including copyright and privacy;
— publish content that is illegal, hateful, harassing, sexually explicit involving minors, or deceptive;
— harm, overload or try to gain unauthorised access to the Platform, other workspaces or connected accounts;
— get around platform or ${COMPANY.product} rate limits, or resell the Platform without our written agreement.

We may suspend or close accounts that break these rules and report illegal activity to the authorities.`,
        },
        {
            id: 'content',
            heading: 'Your content',
            content: `You keep ownership of everything you upload or create. You give us a limited licence to store, process and transmit it only as needed to run the Platform for you, for example to render a video or publish a post. We do not use your content to train AI models.

You confirm you have the rights needed for content you publish, including music, footage and images. Review AI-generated content before you publish it; we do not guarantee it is accurate or original.`,
        },
        {
            id: 'billing',
            heading: 'Plans and payment',
            content: `We offer a free plan and paid plans. Prices and limits are shown at ${COMPANY.site}/pricing. Paid plans are billed in advance in South African Rand through Paystack, including VAT where applicable. Usage allowances reset each billing period and do not roll over.

You can cancel at any time by emailing ${COMPANY.billingEmail} (the Billing page links to it); cancellation takes effect at the end of the paid period. First-time subscribers may cancel within 7 days for a full refund. Under section 14 of the Consumer Protection Act 68 of 2008 you may cancel a fixed-term agreement with 20 business days' notice.`,
        },
        {
            id: 'privacy',
            heading: 'Privacy and data protection',
            content: `Our Privacy Policy (${COMPANY.site}/privacy) explains how we handle personal information and forms part of these Terms.

For your audience's comments and messages, you are the responsible party under POPIA and we process that information on your instructions. You must have a lawful reason to process it and must tell your audience how you use it.`,
        },
        {
            id: 'termination',
            heading: 'Ending the agreement',
            content: `You can delete your account at any time in Settings. We may suspend or close your account if you seriously or repeatedly break these Terms, if the law requires it, or if your use puts others at risk. Where reasonable, we will warn you first.

When an account is deleted, we delete its data as described in the Privacy Policy.`,
        },
        {
            id: 'liability',
            heading: 'Liability',
            content: `The Platform is provided "as is". To the extent the law allows, we are not liable for indirect or consequential loss, lost profits or data, or losses caused by social platforms, and our total liability is limited to the fees you paid us in the 12 months before the claim.

Nothing in these Terms limits liability that cannot be limited by law, including under the Consumer Protection Act 68 of 2008, or liability for gross negligence or fraud.`,
        },
        {
            id: 'disputes',
            heading: 'Disputes and governing law',
            content: `These Terms are governed by the laws of the Republic of South Africa. We will first try to resolve any dispute by negotiation. If that fails within 30 days, either party may refer it to mediation, and then to arbitration, under the rules of the Arbitration Foundation of Southern Africa (AFSA), without affecting your rights under the Consumer Protection Act.`,
        },
        {
            id: 'changes',
            heading: 'Changes',
            content: `If we make a material change to these Terms, we will email account owners at least 30 days before it takes effect. If you do not agree, you may cancel before then.`,
        },
        {
            id: 'contact',
            heading: 'Contact',
            content: `${COMPANY.operator}, operator of ${COMPANY.product}
Registration number: ${COMPANY.registration}${COMPANY.address ? `\nAddress: ${COMPANY.address}` : ''}
Support: ${COMPANY.supportEmail}
Billing: ${COMPANY.billingEmail}
Privacy: ${COMPANY.privacyEmail}
Website: ${COMPANY.site}`,
        },
    ],
};

export const DATA_DELETION = {
    slug: 'data-deletion',
    title: 'Data Deletion',
    summary: `How to delete the data ${COMPANY.product} holds about you, how to revoke our access to your social accounts, and how to check a deletion request.`,
    effectiveDate: EFFECTIVE,
    lastUpdated: EFFECTIVE,
    sections: [
        {
            id: 'disconnect',
            heading: 'Delete the data for one connected account',
            content: `1. Sign in at ${COMPANY.site} and open Connections.
2. Choose the account (Instagram, Facebook Page, Meta ad account, TikTok or YouTube) and select Disconnect.
3. We revoke our access with the platform where it allows this and delete the access token immediately. Messages, comments, profile details and analytics we stored from that account are deleted within 7 days.`,
        },
        {
            id: 'account',
            heading: 'Delete your whole account',
            content: `1. Sign in and open Settings.
2. Select Delete account and confirm.
3. Your workspaces, uploaded content, schedules, automations, connected accounts and their data are deleted, and your sign-in is removed. Deletion completes within 30 days. Billing records are kept for 5 years because tax law requires it.

If you can no longer sign in, email ${COMPANY.privacyEmail} from the address on your account and we will delete it for you within 30 days.`,
        },
        {
            id: 'meta',
            heading: 'Remove KenganSocial from Facebook or Instagram',
            content: `— Facebook: Settings & privacy → Settings → Business integrations (https://www.facebook.com/settings?tab=business_tools) → select ${COMPANY.product} → Remove.
— Instagram: Settings → Apps and websites (https://www.instagram.com/accounts/manage_access/) → select ${COMPANY.product} → Remove.

You can then choose to send a deletion request. Meta passes it to us automatically: we delete the data connected to your Facebook or Instagram account and Meta shows you a link to the status of your request, with a confirmation code. You can also check a code below.`,
        },
        {
            id: 'others',
            heading: 'Remove KenganSocial from TikTok or Google',
            content: `— TikTok: Settings and privacy → Security → Manage app permissions → ${COMPANY.product} → Remove access.
— Google / YouTube: https://myaccount.google.com/permissions → ${COMPANY.product} → Remove access.

When a platform tells us our access was removed, or refuses our access the next time we use it, we delete the token and that account's stored data within 7 days.`,
        },
        {
            id: 'audience',
            heading: 'If you messaged or commented on a KenganSocial customer',
            content: `Businesses use ${COMPANY.product} to manage the comments and messages people send to their accounts. If you contacted one of them, that business controls your messages; you can ask them directly to delete them.

You can also email ${COMPANY.privacyEmail} with the platform and your username. We will find and delete the copies stored in ${COMPANY.product} within 30 days and tell the business concerned.`,
        },
        {
            id: 'status',
            heading: 'Check a deletion request',
            content: `Open ${COMPANY.site}/data-deletion/status and enter the confirmation code you received, or follow the link Facebook or Instagram gave you.

Questions: ${COMPANY.privacyEmail}`,
        },
    ],
};

export const LEGAL_DOCS = [TERMS, PRIVACY, DATA_DELETION];

/**
 * Splits text into plain, URL and email parts so both renderers can link them.
 * Trailing punctuation (".", ",", ";", ":") stays outside the link.
 */
export function linkParts(text) {
    const parts = [];
    const re = /(https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
        let value = m[0];
        const trail = value.match(/[.,;:]+$/);
        if (trail) value = value.slice(0, -trail[0].length);
        if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
        parts.push({ type: value.includes('@') && !value.startsWith('http') ? 'email' : 'url', value });
        last = m.index + value.length;
    }
    if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
    return parts;
}
