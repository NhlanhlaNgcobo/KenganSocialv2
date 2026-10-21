// Checks a live deployment (docs/DEPLOY.md, step 8). Run from the repository root:
//   node scripts/check-deploy.mjs https://kengansocial.co.za https://api.kengansocial.co.za
const [web, api] = process.argv.slice(2).map((u) => (u || '').replace(/\/+$/, ''));
if (!web || !api) {
    console.error('Usage: node scripts/check-deploy.mjs <web-app-url> <api-url>');
    process.exit(2);
}
let failures = 0;
const check = (ok, label) => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const get = async (url, init) => {
    try {
        return await fetch(url, { redirect: 'manual', ...init });
    } catch (error) {
        return { ok: false, status: 0, headers: new Headers(), text: async () => '', error };
    }
};

// Web app (Vercel)
const home = await get(web);
const html = await home.text();
check(home.ok, `web app loads (${home.status})`);
for (const header of ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) {
    check(home.headers.get(header), `web app sends ${header}`);
}
const script = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
if (script) {
    const bundle = await (await get(new URL(script, web).href)).text();
    check(!bundle.includes('localhost:5000'), 'built app does not call localhost');
    check(bundle.includes(api), `built app calls ${api}`);
}
for (const slug of ['privacy', 'terms', 'data-deletion']) {
    const r = await get(`${web}/${slug}`);
    const body = await r.text();
    // The static copy is readable without JavaScript (what platform reviewers' crawlers see).
    check(r.ok && /KenganSocial/.test(body) && body.length > 3000, `${web}/${slug} is a readable static page (${r.status}, ${body.length} bytes)`);
}
const deep = await get(`${web}/dashboard`);
check(deep.ok, `deep link /dashboard serves the app (${deep.status})`);

// API (VM)
const health = await get(`${api}/api/health`);
check(health.ok && /"ok"/.test(await health.text()), `API health (${health.status})`);
const plain = await get(api.replace(/^https:/, 'http:') + '/api/health');
check([301, 302, 307, 308].includes(plain.status), `http:// redirects to https:// (${plain.status})`);
const cors = await get(`${api}/api/health`, { headers: { Origin: web } });
check(cors.headers.get('access-control-allow-origin') === web, `API allows the web app origin (${cors.headers.get('access-control-allow-origin')})`);
const evil = await get(`${api}/api/health`, { headers: { Origin: 'https://evil.example' } });
check(!evil.headers.get('access-control-allow-origin'), 'API refuses other origins');
const local = await get(`${api}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
check(!local.headers.get('access-control-allow-origin'), 'API refuses localhost in production');
const features = await get(`${api}/api/features`);
check(features.ok, `API /api/features (${features.status})`);
const meta = await get(`${api}/api/data-deletion/meta`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'signed_request=bad.bad' });
check(meta.status === 400, `Meta data-deletion callback rejects forged requests (${meta.status})`);
const me = await get(`${api}/api/auth/me`);
check(me.status === 401, `signed-out requests are refused (${me.status})`);

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
