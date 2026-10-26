/**
 * Optional AI features, switched on or off with LAUNCH_AI_FEATURES so the first launch can run on
 * the core AI only (clip finding, captions, hooks, hashtags, the AI Writer's text), which are
 * always on. Each optional feature has a working non-AI version, used while it is off.
 *
 *   (unset)                                   the launch default: only cloudTranscription on, so long
 *                                             clip videos stay quick (scripts/capacity-model.mjs, launchStt)
 *   LAUNCH_AI_FEATURES=                       (empty) all optional AI off
 *   LAUNCH_AI_FEATURES=all                    everything on
 *   LAUNCH_AI_FEATURES=aiImages,voiceover     only these on
 *
 * Costs per feature are in docs/pricing/KenganSocial_Pricing_Model.pdf.
 */
export const OPTIONAL_AI_FEATURES = {
    lyricsAi: 'Lyrics: syncing to the vocals and AI song structure (speech-to-text and a large model)',
    aiImages: 'AI images in carousels, thumbnail backgrounds and the AI Writer (free images stay available)',
    voiceover: 'AI voiceover in video ads (ElevenLabs)',
    aiMusic: 'AI-composed music for video ads and launch videos (Treblo); the free music library is used instead',
    cloudTranscription: 'Speech-to-text API for long clip videos; the server transcribes them itself instead',
    trendingSearch: 'Live web search for trending ideas (Perplexity)',
    dmDrafts: 'AI reply drafts for DMs and lead outreach; keyword auto-replies keep working',
    styleLearning: 'AI Edit learning a style from a reference video; the built-in presets keep working',
    websiteAi: 'AI business profile and brand voice from a website; colours, fonts and logo are still read',
    thumbnailHeadlines: 'AI thumbnail headline ideas; headlines are built from the clip instead',
    storyboardAi: 'AI storyboards for launch and tutorial videos; built from the site and its pages instead',
} as const;

export type OptionalAiFeature = keyof typeof OPTIONAL_AI_FEATURES;

/** Optional features on when LAUNCH_AI_FEATURES is not set at all. */
export const LAUNCH_DEFAULT = 'cloudTranscription';

function enabledSet(): Set<string> {
    const raw = String(process.env.LAUNCH_AI_FEATURES ?? LAUNCH_DEFAULT).trim();
    if (raw.toLowerCase() === 'all') return new Set(Object.keys(OPTIONAL_AI_FEATURES));
    return new Set(raw.split(',').map((s) => s.trim()).filter((s) => s in OPTIONAL_AI_FEATURES));
}

/** Whether an optional AI feature is switched on (read on every call, so a restart picks up changes). */
export function aiFeature(id: OptionalAiFeature): boolean {
    return enabledSet().has(id);
}

/** Every optional feature and whether it is on: for the client (GET /api/ai/status) and logs. */
export function aiFeatureStatus(): Record<OptionalAiFeature, boolean> {
    const on = enabledSet();
    return Object.fromEntries(Object.keys(OPTIONAL_AI_FEATURES).map((id) => [id, on.has(id)])) as Record<OptionalAiFeature, boolean>;
}

/** The message shown when a switched-off feature is asked for. */
export const COMING_SOON = 'This AI feature is coming soon. It is switched off for now.';
