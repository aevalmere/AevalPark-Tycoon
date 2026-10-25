import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any sub-path (GitHub Pages, itch.io, a folder).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        // libraries in their own chunks: a game update doesn't make returning players re-download the map engine
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\/](maplibre-gl|@maplibre)/ },
            { name: 'react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
          ],
        },
      },
    },
  },
});
