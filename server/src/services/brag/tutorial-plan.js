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

/** A heading as the section it introduces: the camera frames the heading and what sits under it. */
function region(el) {
    if (!el) return null;
    if (el.kind !== 'heading') return el;
    const x = Math.max(0, el.x - 3);
    const y = Math.max(0, el.y - 4);
    return { ...el, x, y, w: Math.min(100 - x, el.w + 6), h: Math.min(100 - y, Math.max(el.h + 40, 32)), kind: 'region' };
}

const NAV = /^(resources|products?|pricing|docs|documentation|blog|company|about|menu|language|en|log ?in|sign ?in|search|more|careers|contact|support|community|changelog)$/i;
const DOABLE = /\b(new|create|add|start|open|share|invite|collab\w*|upload|import|export|draw|rectangle|text|record|publish|write|generate|try|templates?)\b/i;

/** "Open Ctrl+O" → "Open", "Live collaboration..." → "Live collaboration" */
const actionLabel = (text) => String(text || '').replace(/\s+(ctrl|cmd|shift|alt|⌘)\s*\+\s*\S+$/i, '').replace(/\s+\?$/, '').replace(/\.{2,}|…$/, '').trim();

/** Buttons on the start page worth trying: real actions, not navigation. */
function homeActions(elements, linkTexts) {
    const list = elements.filter((e) => {
        const label = actionLabel(e.text);
        return e.kind === 'button' && label.length >= 3 && label.length <= 24 && !NAV.test(label) && !linkTexts.has(e.text.toLowerCase()) && DOABLE.test(`${label} ${e.hint || ''}`);
    });
    const top = list.filter((e) => e.y < 15).sort((a, b) => b.priority - a.priority || a.x - b.x);
    const main = list.filter((e) => e.y >= 15).sort((a, b) => b.priority - a.priority || a.y - b.y);
    return [main[0], top[0], ...main.slice(1)].filter(Boolean);
}

/** "at the top left of the screen", "in the middle of the screen" … */
const where = (el) => {
    const cx = el.x + el.w / 2;
    const side = cx < 33 ? 'left' : cx > 66 ? 'right' : '';
    if (el.y < 15) return `at the top${side ? ` ${side}` : ''} of the screen`;
    if (el.y > 80) return `at the bottom${side ? ` ${side}` : ''} of the screen`;
    return side ? `on the ${side} of the screen` : 'in the middle of the screen';
};

/** Steps built from the explored pages alone (no model needed). */
export function fallbackTutorial(app) {
    const [home, ...rest] = app.pages;
    const name = app.name || new URL(app.url).hostname;
    const host = new URL(app.url).hostname.replace(/^www\./, '');
    const steps = [];
    const homeShot = shotOf(home);
    const hero = homeShot.elements.find((e) => e.tag === 'h1') || homeShot.elements.find((e) => e.kind === 'heading');
    const pages = rest.slice(0, 3);
    const linkTexts = new Set(pages.map((p) => String(p.via?.text || '').toLowerCase()));

    steps.push(
        stepScene({
            page: home,
            target: region(hero),
            action: 'look',
            headline: `Open ${host}`,
            subline: hero?.text && hero.text.split(' ').length <= 12 ? hero.text : app.description,
        })
    );

    // Things to do right on the start page (an editor's tools, "New", "Share"…), one near the top
    // and one in the main area, so the tutorial shows the app itself, not only its links.
    const actions = homeActions(homeShot.elements, linkTexts);
    for (const el of actions.slice(0, pages.length >= 2 ? 1 : 2)) {
        const label = actionLabel(el.text);
        steps.push(stepScene({ page: home, target: { ...el, text: label }, action: 'click', headline: `Click “${words(label, 4)}”`, subline: el.hint && el.hint.length > label.length + 3 ? el.hint : `You'll find it ${where(el)}.` }));
    }

    if (home.shots.length > 1) {
        steps.push(stepScene({ page: home, action: 'scroll', headline: 'Scroll to see what it does', subline: sentence(home.paragraphs[0] || home.headings[1] || app.description, 18) }));
    }

    for (const page of pages.slice(0, Math.max(1, 5 - steps.length))) {
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
                    target: heading ? region(heading) : button,
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
