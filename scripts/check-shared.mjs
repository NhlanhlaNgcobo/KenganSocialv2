// Fails when files that must be identical in the client and the server have drifted apart.
// Run: node scripts/check-shared.mjs   (also run before deploying)
import fs from 'fs';

const PAIRS = ['color-pipeline.js', 'trend-transitions.js', 'trend-effects.js', 'caption-motion.js', 'keyframes.js'].map((name) => [`client/src/editor/lib/${name}`, `server/src/services/${name}`]);
let ok = true;
for (const [a, b] of PAIRS) {
    if (fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) {
        console.error(`Out of sync: ${a} and ${b}. Copy the edited one over the other.`);
        ok = false;
    }
}
if (ok) console.log('Shared files are in sync.');
process.exit(ok ? 0 : 1);
