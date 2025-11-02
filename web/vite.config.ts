import { defineConfig } from 'vite'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

export default defineConfig({
  server: {
    port: 8000,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  plugins: [
    {
      name: 'copy-redirects',
      closeBundle() {
        try {
          copyFileSync(join(process.cwd(), '_redirects'), join(process.cwd(), 'dist', '_redirects'))
        } catch (error) {
          console.warn('Failed to copy _redirects file:', error)
        }
      },
    },
  ],
})
