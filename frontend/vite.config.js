import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// ============================================
// NETWORK IP CONFIGURATION - Switch between networks
// ============================================
// Active: Phone Hotspot (10.199.210.137)
// Commented: WiFi Network (192.168.1.4)
// To switch: Comment/uncomment the active lines below
// ============================================

export default defineConfig({
  plugins: [react()],
  server: {
    // Phone Hotspot - ACTIVE
    //host: '10.199.210.137',
    // WiFi Network - COMMENTED OUT
    host: '192.168.1.4',
    port: 5173,
    https: {
      // Phone Hotspot - ACTIVE
      //key: fs.readFileSync(path.resolve(__dirname, '10.199.210.137-key.pem')),
      //cert: fs.readFileSync(path.resolve(__dirname, '10.199.210.137.pem')),
      // WiFi Network - COMMENTED OUT
      key: fs.readFileSync(path.resolve(__dirname, '192.168.1.4-key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, '192.168.1.4.pem')),
    },
  },
})