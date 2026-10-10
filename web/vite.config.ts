import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The cockpit is served at / and the Center platform at /center/ from the same origin,
// so the API is called on a relative path and no CORS or proxy is needed in production.
export default defineConfig({
  plugins: [react()],
  base: '/center/',
  server: {
    allowedHosts: true,
    fs: {allow: ['..']}, // Shared immutable cosmetic/content manifests live in the repo root.
    proxy: {
      '/api/center': { target: 'http://127.0.0.1:8099', changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Keep modular Babylon shaders/loaders in one lazy engine payload instead of
    // issuing hundreds of tiny cold-load requests. Other games retain Three.
    rolldownOptions: {
      output: {codeSplitting: {groups: [{name:'babylon-engine',test:/\/@babylonjs\//,includeDependenciesRecursively:false}]}},
    },
  },
})
