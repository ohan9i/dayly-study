import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Relative assets also work under a GitHub Pages repository path.
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than the planner does, so a return
        // visit after a deploy re-downloads only the app's own code.
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'supabase';
          if (/node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id))
            return 'motion';
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
