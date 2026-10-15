import { generateJson } from '../gemini-json.js';
import { headline as headlineText, shortLine } from './text.js';

/**
 * Turns an explored web app (explore.js) into tutorial scenes:
 *   intro → steps (look / click / type / scroll on the real screens) → outro.
 * A model writes the steps when one is configured; otherwise they come straight from the
 * app's own pages, links and headings. Steps never invent features: every step points at a
 * screen that was actually captured.
 */

const words = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ');
const sentence = (s, n) => shortLine(s, n);

function readTime(scene, actionSeconds) {
    const count = `${scene.headline} ${scene.subline}`.split(' ').filter(Boolean).length;
    return Math.max(3, Math.min(7.5, count * 0.28 + actionSeconds));
}

/** Sample text for a form field, chosen from its label. */
/** What a form field asks for, from its label, placeholder ("John Doe", "jane@company.com") or type. */
export function fieldKind(el) {
    const raw = String(el.text || '').trim();
    const label = `${raw} ${el.inputType || ''}`.toLowerCase();
    if (/mail|@/.test(label)) return 'email';
    if (/pass/.test(label)) return 'password';
    if (/name/.test(label) || /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(raw)) return 'name';
    if (/company|business|organi[sz]ation/.test(label)) return 'company';
    if (/url|website|domain|link|\.com|\.co\b/.test(label)) return 'website';
    if (/search|ask/.test(label)) return 'search';
    if (/phone|mobile|tel/.test(label)) return 'phone';
    return 'text';
}

function sampleFor(el) {
    const label = fieldKind(el);
    if (/mail/.test(label)) return 'alex@yourbrand.co.za';
    if (/pass/.test(label)) return '••••••••';
    if (/name/.test(label)) return 'Alex Mokoena';
    if (/company|business|organi[sz]ation/.test(label)) return 'Your Brand';
    if (/url|website|domain|link/.test(label)) return 'yourbrand.co.za';
    if (/search|ask/.test(label)) return 'How do I get started?';
    if (/phone|mobile/.test(label)) return '082 123 4567';
    return 'Hello!';
}

const FIELD_HINTS = {
    email: 'Enter your email address to continue.',
    name: 'Type your name to continue.',
    password: 'Choose a password.',
    company: 'Add your company name.',
    website: 'Add your website address.',
    search: 'Type what you need and it finds it.',
    phone: 'Add your phone number.',
};

function shotOf(page, i = 0) {
    return page.shots[Math.min(i, page.shots.length - 1)];
}

function findElement(shot, text) {
    if (!text) return null;
    const t = text.toLowerCase();
    return shot.elements.find((e) => e.text.toLowerCase() === t) || shot.elements.find((e) => e.text.toLowerCase().includes(t) || t.includes(e.text.toLowerCase())) || null;
}

const box = (el) => (el ? { x: el.x, y: el.y, w: el.w, h: el.h, kind: el.kind, text: el.text } : null);

function stepScene({ page, shotIndex = 0, target, action, headline, subline, typed }) {
    const scene = {
        type: 'step',
        headline: headlineText(headline, 8),
        subline: shortLine(subline, 20),
        screenshotData: shotOf(page, shotIndex).data,
        nextShotData: action === 'scroll' && page.shots[1] ? page.shots[1].data : null,
        target: box(target),
        action,
        typed: typed || '',
        path: page.path,
    };
    scene.duration = readTime(scene, action === 'type' ? 2.6 : action === 'click' ? 2 : action === 'scroll' ? 2.4 : 1.6);
    return scene;
}

/** Steps built from the explored pages alone (no model needed). */
export function fallbackTutorial(app) {
    const [home, ...rest] = app.pages;
    const name = app.name || new URL(app.url).hostname;
    const host = new URL(app.url).hostname.replace(/^www\./, '');
    const steps = [];
    const homeShot = shotOf(home);
    const hero = homeShot.elements.find((e) => e.tag === 'h1') || homeShot.elements.find((e) => e.kind === 'heading');

    steps.push(
        stepScene({
            page: home,
            target: hero,
            action: 'look',
            headline: `Start at ${host}`,
            subline: hero?.text ? `${name}: ${hero.text}` : app.description,
        })
    );
    if (home.shots.length > 1) {
        steps.push(stepScene({ page: home, action: 'scroll', headline: 'See what it does', subline: sentence(home.paragraphs[0] || home.headings[1] || app.description, 18) }));
    }

    for (const page of rest.slice(0, 3)) {
        const link = page.via?.text;
        const fromShot = homeShot;
        const linkEl = page.via?.box ? { ...page.via.box, kind: 'link', text: link } : findElement(fromShot, link);
        if (linkEl) {
            steps.push(stepScene({ page: home, target: linkEl, action: 'click', headline: `Click “${words(link, 4)}”`, subline: `It opens ${page.title.split(/[|—–-]/)[0].trim() || page.path}.` }));
        }
        const shot = shotOf(page);
        const field = shot.elements.find((e) => e.kind === 'field');
        const heading = shot.elements.find((e) => e.kind === 'heading');
        if (field) {
            steps.push(
                stepScene({
                    page,
                    target: field,
                    action: 'type',
                    typed: sampleFor(field),
                    headline: headlineText(page.headings[0] || 'Fill in your details', 7),
                    subline: FIELD_HINTS[fieldKind(field)] || 'Fill in your details and continue.',
                })
            );
        } else {
            const button = shot.elements.find((e) => e.kind === 'button');
            steps.push(
                stepScene({
                    page,
                    target: heading || button,
                    action: heading ? 'look' : 'click',
                    headline: headlineText(page.headings[0] || link || 'Explore', 7),
                    subline: sentence(page.paragraphs[0] || page.headings[1] || '', 18),
                })
            );
        }
    }
    return steps;
}

function promptFor(app) {
    const pages = app.pages.map((p, pi) => ({
        page: pi,
        path: p.path,
        title: p.title,
        cameFromLink: p.via?.text || null,
        headings: p.headings.slice(0, 5),
        text: p.paragraphs.slice(0, 2),
        shots: p.shots.map((s, si) => ({ shot: si, elements: s.elements.slice(0, 10).map((e, ei) => ({ el: ei, kind: e.kind, text: e.text })) })),
    }));
    return `You are making a short screen-recording style TUTORIAL video that teaches a new user how to start using this web app.
App: ${app.name} (${app.url})
Description: ${app.description}
Captured screens (only these exist; each element has an index you can point at):
${JSON.stringify(pages)}

Write 4 to 7 steps a beginner follows in order. Each step happens on one captured screen and points at one element.
Rules:
- Only use pages, shots and elements listed above. Never invent features, prices or numbers.
- action is "click" (buttons/links), "type" (fields only; give realistic sample text in "typed"), "look" (a heading or area to notice) or "scroll" (shot 0 to shot 1 of the same page).
- A step that clicks a link should usually be followed by a step on the page that link opens (its cameFromLink matches).
- headline: an instruction, max 7 words ("Click Get started", "Enter your work email").
- subline: what happens or why it matters, max 18 words, plain and friendly.

Return ONLY JSON: {"steps":[{"page":0,"shot":0,"el":0,"action":"click","headline":"...","subline":"...","typed":""}],"outro":{"headline":"max 6 words","cta":"a real call to action from the app, max 4 words"}}`;
}

function fromModel(raw, app) {
    const steps = [];
    for (const s of Array.isArray(raw?.steps) ? raw.steps.slice(0, 8) : []) {
        const page = app.pages[s.page];
        if (!page) continue;
        const shotIndex = Number.isInteger(s.shot) && page.shots[s.shot] ? s.shot : 0;
        const shot = page.shots[shotIndex];
        const target = Number.isInteger(s.el) ? shot.elements[s.el] || null : null;
        const action = ['click', 'type', 'look', 'scroll'].includes(s.action) ? s.action : 'look';
        if (action === 'type' && target?.kind !== 'field') continue;
        steps.push(stepScene({ page, shotIndex: action === 'scroll' ? 0 : shotIndex, target, action, headline: s.headline, subline: s.subline, typed: action === 'type' ? words(s.typed, 6) || sampleFor(target) : '' }));
    }
    return steps.length >= 3 ? { steps, outro: raw.outro || {} } : null;
}

/**
 * @returns {Promise<{ plan, planner }>} plan has the same shape as launch plans (scenes, productName, shareCopy, tone)
 */
export async function planTutorial(app, { focus = '' } = {}) {
    const name = app.name || new URL(app.url).hostname;
    const host = new URL(app.url).hostname.replace(/^www\./, '');
    let planner = 'fallback';
    let built = null;
    try {
        const parts = [{ text: promptFor(app) + (focus ? `\nThe user wants the tutorial to focus on: ${focus}` : '') }];
        built = fromModel(await generateJson(parts), app);
        if (built) planner = 'ai';
    } catch (error) {
        console.warn('[Tutorial] Planner fell back to page structure:', error.message);
    }
    const steps = built?.steps || fallbackTutorial(app);
    const homeCta = app.pages[0].shots[0].elements.find((e) => e.kind === 'button' && /start|try|sign|join|create|free|book|demo/i.test(e.text));

    const scenes = [
        { type: 'intro', eyebrow: 'Tutorial', headline: words(`How to use ${name}`, 8), subline: sentence(app.description, 16), duration: 3.2 },
        ...steps.map((s, i) => ({ ...s, step: i + 1 })),
        {
            type: 'outro',
            headline: words(built?.outro?.headline || `Try ${name} yourself`, 7),
            subline: host,
            cta: words(built?.outro?.cta || homeCta?.text || 'Get started', 4),
            duration: 3.4,
        },
    ].map((s) => ({ ...s, duration: Math.round(s.duration * 30) / 30 }));

    return {
        planner,
        plan: {
            kind: 'tutorial',
            angle: `A step-by-step walkthrough of ${name}`,
            productName: words(name, 5),
            shareCopy: `New to ${name}? Here's how to get started in ${steps.length} steps. ${host}`,
            tone: 'tutorial',
            scenes,
        },
    };
}
