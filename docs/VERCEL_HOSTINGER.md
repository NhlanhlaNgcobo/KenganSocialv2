# Vercel frontend / Hostinger backend

## Vercel settings

- Repository: KenganSocialv2, deploy the current changes (pilot access UI and backend changes are not yet committed).
- Root directory: `client`.
- Framework: Vite.
- Build command: `npm run build`.
- Output: `dist`.
- Production domain: `kengansocial.co.za`.
- Import local `output/vercel-beta.env` into the Vercel project's Production environment. It contains the frontend Firebase configuration and `VITE_API_URL=https://api.kengansocial.co.za/api`; no server credentials. Keep Firebase service-account files and server/.env off Vercel.
- Redeploy after setting variables. Use the custom production domain for testing; arbitrary Vercel preview domains are not allowed by the API CORS policy or Firebase sign-in configuration.
- Existing `client/vercel.json` handles SPA routes and security headers.

## GoDaddy DNS

Keep root (`@`) and `www` configured as Vercel instructs. Do not change mail records.

Add `api`, type A, value `187.7.28.20`. Hostinger's existing Traefik proxy routes only `api.kengansocial.co.za` to KenganSocial; n8n remains separate. TLS can be issued after DNS propagates.

## Pilot

Use Google sign-in with one of the five invited Gmail accounts. The list is held on the backend only. Public clip processing, unauthenticated external reviews and social callbacks remain blocked by the pilot gate. No invitation emails have been sent.
