import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative assets also work under a GitHub Pages repository path.
  base: './',
  server: { port: 5173, strictPort: true },
});
