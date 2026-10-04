import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  // `npm run dev` is optional hot-reload mode; it proxies to the Python server.
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: server, ws: true },
      '/media': server,
    },
  },
});
