import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Socket.IO — proxy BOTH http polling and ws upgrade
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
      // REST API
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Preview proxy
      '/preview': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Gemini Live WebSocket
      '/gemini-live': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
    }
  }
});
