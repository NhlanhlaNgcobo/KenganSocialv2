import type { AutoCutTemplate } from './templates';
import type { ClipEffect, ClipTransition } from '../types';

export interface RecipeShot {
    label: string;
    seconds: number;
    speed?: number;
    sourcePosition?: number;
    transition?: ClipTransition | null;
    effects?: ClipEffect[];
    title?: string;
    overlay?: 'inset' | 'split';
    repeatSource?: number;
}
const transition = (type: ClipTransition['type'], duration = 0.4): ClipTransition => ({ type, duration });
const fx = (type: ClipEffect['type'], amount = 0.45): ClipEffect[] => [{ type, amount }];
const common = { ratio: '9:16' as const, strategy: 'even' as const, clipSeconds: [1, 4] as [number, number], fill: true, framing: 'none' as const, captions: null, filter: 'none' as const };

export const TREND_TEMPLATES: AutoCutTemplate[] = [
    { ...common, id: 'ks-video-drop-switch', name: 'Drop Switch', description: 'A quiet setup, lens-cover reveal, three fast details and a held payoff. Assign before and after footage to the slots.', targetSeconds: 12, hookText: 'Same place. New energy.', recipe: [
        { label: 'Before', seconds: 2 }, { label: 'Reveal', seconds: 3, transition: transition('ks-lens-cover', 0.5), effects: fx('ks-exposure-hit', 0.3) },
        { label: 'Detail 1', seconds: 1 }, { label: 'Detail 2', seconds: 1 }, { label: 'Detail 3', seconds: 1 }, { label: 'After', seconds: 4, transition: transition('ks-focus-snap') },
    ] },
    { ...common, id: 'ks-video-velocity-run', name: 'Velocity Run', description: 'Editable slow and fast speed blocks with impact cuts. Best with high-frame-rate action footage; these are stepped speeds, not optical-flow ramps.', targetSeconds: 15, filter: 'drama', recipe: [
        { label: 'Slow opening', seconds: 3, speed: 0.5 }, { label: 'Accelerate', seconds: 1, speed: 2 }, { label: 'Impact', seconds: 3, speed: 0.6, transition: transition('ks-whip-carry'), effects: fx('ks-impact-shake', 0.5) },
        { label: 'Fast travel', seconds: 1, speed: 2.5 }, { label: 'Hero movement', seconds: 4, speed: 0.5, transition: transition('ks-spin-catch') }, { label: 'Settle', seconds: 3 },
    ] },
    { ...common, id: 'ks-video-camera-roll', name: 'Camera Roll Diary', description: 'Eight memories, alternating image movement, a paired postcard and a paper-tear chapter change.', targetSeconds: 18, filter: 'film-warm', framing: 'kenburns', hookText: 'A few things I want to remember', recipe: [
        { label: 'Opening memory', seconds: 3 }, { label: 'Small detail', seconds: 2 }, { label: 'People', seconds: 2, overlay: 'split' }, { label: 'Place', seconds: 2, transition: transition('ks-tear-through', 0.55) },
        { label: 'Moment', seconds: 2 }, { label: 'Texture', seconds: 2 }, { label: 'Favourite', seconds: 2 }, { label: 'Last memory', seconds: 3 },
    ] },
    { ...common, id: 'ks-video-proof-first', name: 'Proof First', description: 'Lead with the result, show three steps, then hold the proof and your call to action. Every title is editable.', targetSeconds: 20, hookText: 'Here is what changed', ctaText: 'See how it works', recipe: [
        { label: 'Result first', seconds: 3, title: 'THE RESULT' }, { label: 'Starting point', seconds: 3, transition: transition('ks-crash-reveal'), title: 'BEFORE' },
        { label: 'Step one', seconds: 3, title: '01 / THE CHANGE' }, { label: 'Step two', seconds: 3, title: '02 / THE PROCESS' },
        { label: 'Evidence', seconds: 5, transition: transition('ks-focus-snap'), title: 'THE PROOF' }, { label: 'Next step', seconds: 3 },
    ] },
    { ...common, id: 'ks-video-reaction-receipt', name: 'Reaction + Receipt', description: 'Keep the opening reaction in an inset over the evidence, then let the punchline take the full screen.', targetSeconds: 15, recipe: [
        { label: 'Reaction', seconds: 2, title: 'Wait. Watch this.' }, { label: 'Evidence', seconds: 5, overlay: 'inset', transition: transition('ks-shutter-roll') },
        { label: 'Context', seconds: 4, overlay: 'inset' }, { label: 'Punchline', seconds: 4, transition: transition('ks-elastic-pull'), effects: fx('ks-impact-shake', 0.25) },
    ] },
    { ...common, id: 'ks-video-fit-check', name: 'Fit Check Switch', description: 'Four outfit reveals alternate lens-cover and whip cuts, with a short detail shot between looks.', targetSeconds: 12, recipe: [
        { label: 'Look 01', seconds: 2.5, title: 'LOOK 01' }, { label: 'Detail 01', seconds: 0.5 }, { label: 'Look 02', seconds: 2.5, title: 'LOOK 02', transition: transition('ks-lens-cover') },
        { label: 'Detail 02', seconds: 0.5 }, { label: 'Look 03', seconds: 2.5, title: 'LOOK 03', transition: transition('ks-whip-carry') }, { label: 'Detail 03', seconds: 0.5 },
        { label: 'Look 04', seconds: 3, title: 'LOOK 04', transition: transition('ks-lens-cover') },
    ] },
    { ...common, id: 'ks-video-desk-to-done', name: 'Desk to Done', description: 'A before shot, three numbered steps, and an after reveal with a comparison inset.', targetSeconds: 20, recipe: [
        { label: 'Before', seconds: 3, title: 'START HERE' }, { label: 'Step 1', seconds: 4, title: '01 / CLEAR IT' }, { label: 'Step 2', seconds: 4, title: '02 / BUILD IT' },
        { label: 'Step 3', seconds: 4, title: '03 / FINISH IT' }, { label: 'After', seconds: 5, overlay: 'inset', transition: transition('ks-focus-snap'), title: 'THAT IS BETTER' },
    ] },
    { ...common, id: 'ks-video-city-postcard', name: 'City Postcard', description: 'Wide shots and tiny details alternate, with one prism chapter change and warm highlight bloom.', targetSeconds: 18, filter: 'golden', framing: 'slow-zoom', hookText: 'Somewhere worth slowing down', recipe: [
        { label: 'Arrival', seconds: 4, effects: fx('ks-halation', 0.3) }, { label: 'Street detail', seconds: 2 }, { label: 'Wide view', seconds: 4, transition: transition('ks-prism-pass', 0.55) },
        { label: 'Local detail', seconds: 2 }, { label: 'Evening', seconds: 3, effects: fx('ks-halation', 0.4) }, { label: 'Goodbye', seconds: 3 },
    ] },
    { ...common, id: 'ks-video-mic-drop', name: 'Mic Drop Insight', description: 'A claim, its explanation, evidence, and a final thought. Source positions advance through the same interview when one video fills the slots.', targetSeconds: 25, framing: 'punch', hookText: 'The part nobody tells you', recipe: [
        { label: 'Opening claim', seconds: 4, sourcePosition: 0 }, { label: 'Explanation', seconds: 8, sourcePosition: 0.2 }, { label: 'Evidence', seconds: 7, sourcePosition: 0.5, transition: transition('ks-focus-snap') },
        { label: 'Final thought', seconds: 6, sourcePosition: 0.8 },
    ] },
    { ...common, id: 'ks-video-return-ticket', name: 'Return Ticket', description: 'A ten-second visual round trip that repeats the opening shot at the end. Adjust the final trim to match your movement for a loop.', targetSeconds: 10, recipe: [
        { label: 'Opening', seconds: 2, sourcePosition: 0 }, { label: 'Go', seconds: 2, transition: transition('ks-whip-carry') }, { label: 'Explore', seconds: 2, transition: transition('ks-elastic-pull') },
        { label: 'Return', seconds: 2, transition: transition('ks-crash-reveal') }, { label: 'Opening reprise', seconds: 2, sourcePosition: 0, repeatSource: 0 },
    ] },
];
