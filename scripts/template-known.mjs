// Ids a template may use, taken from what the EXPORT renderer supports (server/src/services), so a
// template that validates also renders. Used by scripts/check-templates.mjs.
import { EFFECT_TYPES, TRANSITIONS } from '../server/src/services/timeline-fx.js';
import { CAPTION_MOTIONS, TEXT_ANIMATIONS } from '../server/src/services/caption-motion.js';
import { LOOK_NAMES } from '../server/src/services/color-pipeline.js';

export const TRANSITIONS_IDS = Object.keys(TRANSITIONS);
export const EFFECT_IDS = [...EFFECT_TYPES];
export const MOTION_IDS = [...CAPTION_MOTIONS, ...TEXT_ANIMATIONS.map((a) => a.id), 'fade', 'pop'];
export const LOOK_IDS = Object.keys(LOOK_NAMES);
