import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During development, forward all Socket.io traffic to the backend.
      // In production, client and server are on the same host so no proxy is needed.
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,       // enable WebSocket proxying
        changeOrigin: true,
      },
    },
  },
});
