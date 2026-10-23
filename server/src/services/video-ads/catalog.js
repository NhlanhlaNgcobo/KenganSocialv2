/**
 * Choices for product ads: 3D presets, what is being advertised, and music moods.
 * Everything here is fixed, so a draft needs no AI call; the client reads it from /options.
 */

/** 3D looks. The Remotion composition (remotion/launch/ProductAd.jsx) implements each id. */
export const PRESETS = {
    turntable: { label: '360° spin', description: 'The product turns on a glossy floor, showing each angle you upload.' },
    orbit: { label: 'Orbit & zoom', description: 'The camera circles the product and pushes in on the details.' },
    float: { label: 'Floating hero', description: 'The product floats in soft light and tilts to show its sides.' },
    reveal: { label: 'Dark reveal', description: 'A spotlight sweeps out of the dark onto the product. Cinematic.' },
    showcase: { label: 'Fast showcase', description: 'Quick, punchy cuts between angles with a selling point on each.' },
};

/** Music moods. `style` is what Treblo is asked to compose. */
export const AD_MOODS = {
    corporate: { label: 'Professional', description: 'Confident, clean and trustworthy', style: 'confident corporate, clean piano and light strings over a steady modern pulse, polished and trustworthy' },
    energetic: { label: 'Energetic', description: 'Hard-hitting, made for training', style: 'high-energy workout track, hard-hitting drums, driving bass and big build-ups, motivating' },
    upbeat: { label: 'Upbeat', description: 'Bright, happy and catchy', style: 'bright, upbeat modern pop with funky bass and claps, positive and catchy' },
    calm: { label: 'Calm', description: 'Soft, warm and soothing', style: 'calm, warm and minimal, soft piano and pads, gentle pulse, soothing' },
    cinematic: { label: 'Cinematic', description: 'Epic, building trailer score', style: 'epic cinematic trailer score, building orchestral strings, deep percussion, big impacts and rising tension' },
    playful: { label: 'Playful', description: 'Fun, quirky and light', style: 'playful and quirky, plucky synths, ukulele and light percussion, cheerful' },
    luxury: { label: 'Luxury', description: 'Sleek, slow and premium', style: 'sleek luxury, smooth deep house with silky keys and a slow confident groove, premium' },
    tech: { label: 'Tech', description: 'Modern, futuristic electronics', style: 'modern futuristic electronic, crisp synth arpeggios, clean beat, innovative and sleek' },
    urban: { label: 'Urban', description: 'Hip hop beat with swagger', style: 'head-nodding hip hop beat, crisp drums, warm 808 bass and a confident swagger' },
};

/** What is being advertised. `mood` is what "Auto" picks; `subject` goes into the music prompt. */
export const CATEGORIES = {
    retail: { label: 'Everyday product', mood: 'upbeat', subject: 'a consumer product' },
    professional: { label: 'Professional service (legal, finance, consulting)', mood: 'corporate', subject: 'a professional services firm' },
    fitness: { label: 'Gym, fitness or sport', mood: 'energetic', subject: 'a gym and fitness brand' },
    beauty: { label: 'Beauty, skincare or wellness', mood: 'calm', subject: 'a beauty and wellness brand' },
    fashion: { label: 'Fashion, jewellery or fragrance', mood: 'luxury', subject: 'a premium fashion brand' },
    food: { label: 'Food and drink', mood: 'playful', subject: 'a food and drink brand' },
    tech: { label: 'Tech, gadgets or apps', mood: 'tech', subject: 'a technology product' },
    kids: { label: 'Kids, toys or pets', mood: 'playful', subject: 'a family-friendly brand' },
    auto: { label: 'Cars or property', mood: 'cinematic', subject: 'a premium car or property brand' },
    street: { label: 'Streetwear, sneakers or music', mood: 'urban', subject: 'a streetwear brand' },
};

/** "auto" (or anything unknown) becomes the mood that fits the category. */
export function resolveMood(mood, category) {
    if (AD_MOODS[mood]) return mood;
    return CATEGORIES[category]?.mood || 'upbeat';
}

/** For /options: the same lists without the server-side prompt text. */
export function publicCatalog() {
    const list = (obj, pick) => Object.entries(obj).map(([id, v]) => ({ id, ...pick(v) }));
    return {
        presets: list(PRESETS, (p) => ({ label: p.label, description: p.description })),
        moods: list(AD_MOODS, (m) => ({ label: m.label, description: m.description })),
        categories: list(CATEGORIES, (c) => ({ label: c.label, mood: c.mood })),
    };
}
