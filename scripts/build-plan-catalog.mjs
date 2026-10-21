// Writes the plan catalog the web app shows on Pricing when the API can't be reached
// (client/src/content/plan-catalog.json), from server/src/config/plan-catalog.ts.
// Run from the repository root after changing prices or plan limits:
//   npx tsx scripts/build-plan-catalog.mjs          (write)
//   npx tsx scripts/build-plan-catalog.mjs --check  (fail if the copy is out of date)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLING_EMAIL, publicCatalog } from '../server/src/config/plan-catalog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'client/src/content/plan-catalog.json');
// Whether payments are set up is only known to the running API; the copy assumes they are not.
const catalog = publicCatalog({ paymentsConfigured: false, supportUrl: `mailto:${BILLING_EMAIL}` });
const json = `${JSON.stringify(catalog, null, 2)}\n`;

if (process.argv.includes('--check')) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== json) {
        console.error('client/src/content/plan-catalog.json is out of date. Run: npx tsx scripts/build-plan-catalog.mjs');
        process.exit(1);
    }
    console.log('Plan catalog copy is up to date.');
} else {
    fs.writeFileSync(out, json);
    console.log(`Wrote ${path.relative(root, out)} (${catalog.plans.length} plans).`);
}
