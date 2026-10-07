/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // X-Pages are distributed as a self-contained folder/zip. Relative URLs
  // keep the build working whether Veeva serves it from a CDN path or locally
  // inside the Vault CRM mobile web view.
  base: './',
  // Broker tests live in broker/ and run with node:test; vitest covers the X-Page only.
  test: { include: ['src/**/*.test.ts'] },
  build: {
    // Vault CRM opens downloaded X-Pages from file:// in WKWebView. ES-module
    // scripts are subject to module CORS checks there, so emit one classic
    // IIFE bundle instead of Vite's normal code-split ESM output.
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/index.js',
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith('.css'))
            ? 'assets/index.css'
            : 'assets/[name][extname]',
      },
    },
  },
})
