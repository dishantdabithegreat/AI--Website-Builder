import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_SERVER_URL || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss()
  ],
})
