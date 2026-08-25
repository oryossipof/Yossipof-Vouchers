import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Supabase's redirect allow list contains http://localhost:5183/**, so the
  // dev server has to stay on that port for password-reset links to work.
  server: { port: 5183 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest rather than generateSW: the expiry reminders need a
      // `push` handler, and that requires a service worker source file of our
      // own. src/sw.ts restates everything generateSW used to inject.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'],
      manifest: {
        name: 'שוברים - כרטיסי מתנה וקופונים',
        short_name: 'שוברים',
        description: 'נהלו את כרטיסי המתנה, הקופונים והשוברים שלכם במקום אחד.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        lang: 'he',
        dir: 'rtl',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Under injectManifest the `workbox` key is ignored entirely; only this
      // one is read, and it cannot express runtime caching. The voucher-photos
      // rule that used to live here is now code in src/sw.ts.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
})
