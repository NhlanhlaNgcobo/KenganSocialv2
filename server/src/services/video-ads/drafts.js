import sharp from 'sharp';
import { inspectWebsite } from '../brag/inspect.js';
import { planVideo } from '../brag/plan.js';
import { inChromeQueue } from '../marketing/chrome-queue.js';
import { clean, fitScenes } from './validation.js';

export async function prepareDraft(input, files, kit = {}, dependencies = {}) {
    const inspect = dependencies.inspect || inspectWebsite;
    const planner = dependencies.plan || planVideo;
    const source = input.url ? await inChromeQueue(() => inspect(input.url, input.format)) : {
        name: input.name, title: input.name, siteName: input.name, description: input.description,
        headings: [], paragraphs: [input.description], ctas: [], screenshots: [], shotElements: [], colors: {},
    };
    const offerings = (source.headings || []).map(h => clean(h, 120)).filter(Boolean).slice(0, 8);
    if (input.name) source.title = source.siteName = source.name = input.name;
    if (input.description) {
        source.description = input.description;
        // A creator-selected offering must not acquire claims from unrelated page sections,
        // including when Brag falls back to deterministic copy without an AI provider.
        source.paragraphs = [input.description];
        source.headings = [];
        source.sections = [];
    }
    // Actual product photos replace website screenshots when supplied by the creator.
    if (files.length) {
        source.screenshots = await Promise.all(files.map(async file => {
            const image = await sharp(file.buffer, { limitInputPixels: 40000000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
            return `data:image/jpeg;base64,${image.toString('base64')}`;
        }));
        source.shotElements = [];
        source.productPhotos = true;
    }
    source.fonts = kit.fonts || source.fonts;
    if (kit.colors?.primary || kit.colors?.background) source.colors = {
        ...source.colors, background: kit.colors.background || source.colors?.background,
        text: kit.colors.text || source.colors?.text, accent: kit.colors.primary || kit.colors.accent || source.colors?.accent,
    };
    const result = await planner(source, { tone: 'polished', format: input.format, duration: input.duration, focus: input.description || source.description || '' });
    const scenes = fitScenes(result.plan.scenes, input.duration);
    if (source.screenshots?.length) scenes.forEach((scene, i) => { if (i > 0 && i < scenes.length - 1) scene.screenshot = (i - 1) % source.screenshots.length; });
    const plan = { ...result.plan, scenes };
    const maxWords = Math.floor(input.duration * 1.65);
    const cta = clean(scenes.at(-1).cta || 'Learn more', 50);
    const words = scenes.slice(0, -1).map(s => clean(s.headline, 100)).join('. ').split(/\s+/);
    const script = `${words.slice(0, Math.max(5, maxWords - cta.split(/\s+/).length)).join(' ')}. ${cta}.`.replace(/\.{2,}/g, '.');
    return { input, source, plan, script, name: clean(plan.productName, 80), description: clean(source.description, 1500), offerings };
}
