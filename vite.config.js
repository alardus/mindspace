import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Version and repository URL come from package.json so the app menu always matches the build.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const repository = String(pkg.repository?.url ?? pkg.repository ?? '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')
  .replace(/\/$/, '')

export default defineConfig({
  plugins: [vue()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_REPOSITORY_URL': JSON.stringify(repository),
  },
})
