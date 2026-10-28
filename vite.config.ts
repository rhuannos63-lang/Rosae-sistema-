import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'marca/*.svg'],
      manifest: {
        name: 'ROSAE · Gestão',
        short_name: 'ROSAE',
        description: 'Sistema de gestão da ROSAE Engenharia & Estruturas',
        lang: 'pt-BR',
        theme_color: '#5B6B2E',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Dados financeiros nunca ficam em cache offline: só a casca do aplicativo.
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [],
      },
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
});
