import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sites } from '@openai/sites-vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/XU-N-T-NG-DASHBOARD/' : '/',
  build: {
    outDir: 'dist/client',
  },
  plugins: [react(), sites()],
})
