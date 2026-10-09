/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MyInsights content is distributed as a self-contained zip. Relative URLs
  // keep the build working whether Veeva CRM serves it online or from the
  // downloaded copy inside the iPad app.
  base: './',
  // Broker tests live in broker/ and run with node:test; vitest covers the MyInsights page only.
  test: { include: ['src/**/*.test.ts'] },
  build: {
    // Veeva CRM opens downloaded MyInsights content from file:// in WKWebView. ES-module
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
