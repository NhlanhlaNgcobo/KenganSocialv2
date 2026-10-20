import type { AutoCutTemplate } from './templates';
import type { RecipeShot } from './trend-templates';

type Category = 'gym' | 'lifestyle' | 'vlog';
// Each recipe specifies its own narrative order, timing, speed and transition accents.
const shot = (label: string, seconds: number, extra: Partial<RecipeShot> = {}): RecipeShot => ({ label, seconds, ...extra });
const cut = (type: NonNullable<RecipeShot['transition']>['type']) => ({ type, duration: 0.35 });
const definitions: [Category, string, string, string, RecipeShot[]][] = [
    ['gym', 'last-rep', 'The Last Rep', 'Build tension through preparation, then hold the final repetition.', [
        shot('Chalk detail', 1), shot('Grip detail', 1), shot('Setup wide', 2), shot('Heavy lift action', 4, { speed: 0.65, transition: cut('ks-crash-reveal') }), shot('Final rep action', 3), shot('Recovery reaction', 3)]],
    ['gym', 'progress-proof', 'Progress Proof', 'Result first, then a dated before-and-after comparison.', [
        shot('After result', 3, { title: 'THE PROGRESS' }), shot('Before starting point', 3, { title: 'WHERE I STARTED' }), shot('Training action', 2), shot('Training detail', 2), shot('After result', 4, { overlay: 'inset', title: 'KEEP SHOWING UP' })]],
    ['gym', 'push-day', 'Push Day Log', 'A training log with an editable exercise chapter for each set.', [
        shot('Gym arrival', 2, { title: 'PUSH DAY' }), shot('Bench press action', 4, { title: '01 / PRESS' }), shot('Shoulder press action', 4, { title: '02 / SHOULDERS' }), shot('Triceps action', 3, { title: '03 / FINISHER' }), shot('Recovery', 2)]],
    ['gym', 'pull-day', 'Pull Day Details', 'Alternate full movements and grip details without covering every cut in effects.', [
        shot('Pull up action', 3), shot('Grip detail', 1), shot('Row action', 4, { transition: cut('ks-whip-carry') }), shot('Cable detail', 1), shot('Curl action', 3), shot('Recovery wide', 3)]],
    ['gym', 'leg-day', 'Leg Day Descent', 'A controlled opening, fast middle and held squat payoff.', [
        shot('Shoes detail', 1.5), shot('Warmup', 2), shot('Squat action', 4, { speed: 0.65 }), shot('Lunge action', 2, { speed: 1.5 }), shot('Leg press action', 3), shot('Recovery reaction', 2.5)]],
    ['gym', 'pr-attempt', 'PR Attempt', 'Set the stakes, preserve the attempt, then let the reaction land.', [
        shot('Weight plates detail', 2, { title: 'ONE MORE ATTEMPT' }), shot('Preparation', 3), shot('Lift action', 7, { transition: cut('ks-focus-snap') }), shot('Reaction celebration', 4), shot('Weight result', 2, { title: 'NEW PERSONAL BEST' })]],
    ['gym', 'form-check', 'Form Check', 'Wide demonstration, detail, correction and a clean final example.', [
        shot('Exercise wide', 4, { title: 'FORM CHECK' }), shot('Grip detail', 3, { title: '01 / SETUP' }), shot('Movement detail', 4, { title: '02 / CONTROL' }), shot('Exercise wide', 5, { title: '03 / PUT IT TOGETHER' })]],
    ['gym', 'early-session', 'Before the City Wakes', 'A quiet morning journey into a focused training session.', [
        shot('Morning clock detail', 2), shot('Shoes preparation', 2), shot('Gym arrival wide', 3), shot('Warmup', 2), shot('Training action', 4), shot('Sunrise exit', 3)]],
    ['gym', 'superset', 'Superset Switch', 'Paired exercises alternate in short, progressively faster blocks.', [
        shot('Exercise A action', 3, { title: 'A' }), shot('Exercise B action', 3, { title: 'B', transition: cut('ks-whip-carry') }), shot('Exercise A action', 2), shot('Exercise B action', 2), shot('Exercise A detail', 1), shot('Exercise B detail', 1), shot('Recovery', 3)]],
    ['gym', 'week-of-work', 'A Week of Work', 'Five compact training chapters ending on recovery, with editable day labels.', [
        shot('Training Monday', 3, { title: 'MON' }), shot('Training Tuesday', 3, { title: 'TUE' }), shot('Training Wednesday', 3, { title: 'WED' }), shot('Training Thursday', 3, { title: 'THU' }), shot('Training Friday', 3, { title: 'FRI' }), shot('Recovery weekend', 3, { title: 'REST IS PART OF IT' })]],
    ['lifestyle', 'morning-ritual', 'Small Morning Rituals', 'Soft establishing shots punctuated by tactile morning details.', [
        shot('Morning window wide', 3), shot('Coffee detail', 2), shot('Skincare detail', 2), shot('Breakfast', 3), shot('Outfit mirror', 3, { transition: cut('ks-focus-snap') }), shot('Leaving home', 3)]],
    ['lifestyle', 'sunday-reset', 'Sunday Reset', 'A clear before, three tasks and a held after reveal.', [
        shot('Room before wide', 3, { title: 'SUNDAY RESET' }), shot('Cleaning action', 2, { speed: 2 }), shot('Laundry action', 2, { speed: 2 }), shot('Meal prep detail', 3), shot('Room after wide', 5, { transition: cut('ks-luma-bloom') })]],
    ['lifestyle', 'outfit-story', 'One Outfit, Four Details', 'Build the look from texture, shoes and accessories before the full reveal.', [
        shot('Clothing texture detail', 1), shot('Shoes detail', 1), shot('Jewellery detail', 1), shot('Bag detail', 1), shot('Outfit full reveal', 5, { transition: cut('ks-lens-cover') }), shot('Walking action', 3)]],
    ['lifestyle', 'coffee-date', 'Coffee Date Postcard', 'A place, a pour and a conversation arranged as a tiny visual postcard.', [
        shot('Cafe exterior wide', 3), shot('Coffee pour detail', 3, { speed: 0.75 }), shot('Pastry detail', 2), shot('Friend reaction', 3), shot('Cafe interior wide', 3), shot('Goodbye street', 2)]],
    ['lifestyle', 'desk-reset', 'Desk Reset ASMR', 'Let short tactile actions lead into a clean workspace reveal.', [
        shot('Desk before', 2), shot('Cleaning detail', 2), shot('Keyboard detail', 2), shot('Notebook detail', 2), shot('Desk after wide', 4, { transition: cut('ks-shutter-roll') })]],
    ['lifestyle', 'night-routine', 'After Hours Ritual', 'A slower evening edit with space for each routine to breathe.', [
        shot('Evening arrival', 3), shot('Dinner detail', 3), shot('Shower skincare detail', 2), shot('Reading', 4), shot('Lamp detail', 2), shot('Night window', 3)]],
    ['lifestyle', 'market-bag', 'From Market to Table', 'Follow the ingredients from a market visit to the finished plate.', [
        shot('Market wide', 3), shot('Produce detail', 2), shot('Shopping bag', 2), shot('Cooking action', 3, { speed: 1.5 }), shot('Plating detail', 3), shot('Meal result', 4, { transition: cut('ks-focus-snap') })]],
    ['lifestyle', 'little-luxuries', 'Little Luxuries', 'Six small pleasures with a paired central memory and restrained movement.', [
        shot('Flowers detail', 3), shot('Coffee detail', 2), shot('Book detail', 3, { overlay: 'split' }), shot('Sunlight texture', 2), shot('Walk outdoors', 3), shot('Home evening', 3)]],
    ['lifestyle', 'room-reveal', 'Room Reveal Walkthrough', 'Start with the finished space, rewind to before, then reveal the work.', [
        shot('Room after wide', 2), shot('Room before wide', 3, { title: 'THE START' }), shot('Decorating action', 2, { speed: 2 }), shot('Furniture detail', 2), shot('Room after wide', 5, { transition: cut('ks-tear-through'), title: 'HOME, AGAIN' })]],
    ['lifestyle', 'weekend-pockets', 'Pockets of a Weekend', 'A gentle collage of places, food and people with a longer closing memory.', [
        shot('Saturday morning', 2), shot('Street wide', 2), shot('Food detail', 1.5), shot('Friends', 3, { overlay: 'split' }), shot('Shopping detail', 1.5), shot('Sunday outdoors', 3), shot('Sunset', 4)]],
    ['vlog', 'day-in-life', 'A Day in Chapters', 'Morning, travel, work and evening with editable chapter cards.', [
        shot('Morning home', 3, { title: 'MORNING' }), shot('Travel commute', 2), shot('Work wide', 4, { title: 'MIDDAY' }), shot('Lunch detail', 2), shot('Evening friends', 4, { title: 'AFTER HOURS' }), shot('Home night', 3)]],
    ['vlog', 'come-with-me', 'Come With Me', 'An invitation, the journey and a destination reveal.', [
        shot('Intro talking', 3, { title: 'COME WITH ME' }), shot('Preparation detail', 2), shot('Travel journey', 3, { speed: 1.5 }), shot('Destination arrival wide', 4, { transition: cut('ks-prism-pass') }), shot('Activity action', 4), shot('Outro reaction', 3)]],
    ['vlog', 'travel-diary', 'Arrival Diary', 'Map the journey from packing to a first impression and evening view.', [
        shot('Packing detail', 2), shot('Airport station wide', 3), shot('Travel window', 3), shot('Arrival destination', 4, { transition: cut('ks-tear-through') }), shot('Local food detail', 2), shot('Evening view', 4)]],
    ['vlog', 'mini-vlog', 'Twelve Second Diary', 'Eight observations in twelve seconds, ending with a held memory.', [
        shot('Opening wide', 2), shot('Detail coffee', 1), shot('Travel', 1), shot('Activity', 1.5), shot('Food detail', 1), shot('Friends', 1.5), shot('Evening detail', 1), shot('Closing sunset', 3)]],
    ['vlog', 'storytime', 'Storytime with Receipts', 'Keep room for the story, insert the evidence, then return to the conclusion.', [
        shot('Intro talking hook', 4), shot('Context talking', 6), shot('Evidence detail', 4, { overlay: 'inset' }), shot('Reaction talking', 4), shot('Conclusion outro', 5)]],
    ['vlog', 'behind-scenes', 'Behind the Finished Frame', 'Lead with the finished shot and reveal the people and process behind it.', [
        shot('Finished result', 3, { title: 'THE SHOT' }), shot('Setup wide', 3, { title: 'BEHIND IT' }), shot('Equipment detail', 2), shot('Working action', 4), shot('Team reaction', 3), shot('Finished result', 3)]],
    ['vlog', 'food-stop', 'Worth the Stop', 'Location, order, preparation, reveal and an honest reaction.', [
        shot('Restaurant exterior', 2), shot('Menu detail', 2), shot('Cooking action', 3), shot('Meal reveal', 4, { transition: cut('ks-focus-snap') }), shot('Tasting reaction', 4), shot('Restaurant outro', 2)]],
    ['vlog', 'week-recap', 'Week in Fragments', 'Seven days with a paper-tear break into the weekend.', [
        shot('Monday', 2, { title: 'MON' }), shot('Tuesday', 2, { title: 'TUE' }), shot('Wednesday', 2, { title: 'WED' }), shot('Thursday', 2, { title: 'THU' }), shot('Friday', 2, { title: 'FRI' }), shot('Saturday', 4, { title: 'SAT', transition: cut('ks-tear-through') }), shot('Sunday', 4, { title: 'SUN' })]],
    ['vlog', 'first-time', 'First Time Trying', 'Make the expectation, attempt and verdict easy to follow.', [
        shot('Intro expectation', 4, { title: 'FIRST TIME TRYING THIS' }), shot('Preparation detail', 2), shot('Attempt action', 6), shot('Reaction', 3), shot('Result verdict', 4, { title: 'THE VERDICT' })]],
    ['vlog', 'quiet-walk', 'Walk Without Words', 'A slow observational walk from wide scenery to textures and back.', [
        shot('Path wide', 4), shot('Footsteps detail', 2), shot('Trees wide', 4), shot('Texture detail', 2), shot('People distant', 3), shot('Sunset wide', 5)]],
];

export const CREATOR_TEMPLATES: AutoCutTemplate[] = definitions.map(([category, slug, name, description, recipe]) => ({
    id: `ks-${category}-${slug}`, category, name, description, recipe,
    ratio: '9:16', strategy: 'even', clipSeconds: [1, 7], fill: true,
    framing: category === 'lifestyle' ? 'kenburns' : 'none', captions: null,
    filter: 'none', targetSeconds: recipe.reduce((sum, s) => sum + s.seconds, 0),
}));
