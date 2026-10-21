import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Variables a production build can't work without. Without VITE_API_URL the built app would
// silently call http://localhost:5000 from every visitor's browser.
const REQUIRED_IN_PRODUCTION = ['VITE_API_URL', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production' && !process.env.ALLOW_LOCAL_API) {
    const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
    const missing = REQUIRED_IN_PRODUCTION.filter((key) => !env[key])
    if (missing.length) throw new Error(`Set ${missing.join(', ')} before building (Vercel: Project Settings > Environment Variables).`)
    if (/localhost|127\.0\.0\.1/.test(env.VITE_API_URL) && process.env.VERCEL) {
      throw new Error('VITE_API_URL points at localhost; set it to the API\'s HTTPS address ending in /api.')
    }
    if (!/\/api\/?$/.test(env.VITE_API_URL)) throw new Error('VITE_API_URL must end in /api, e.g. https://api.example.com/api')
  }
  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
    },
  }
})
