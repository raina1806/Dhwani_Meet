// Configuration for API and Socket.io connections
// Update these values based on your backend server location

// ============================================
// NETWORK IP CONFIGURATION - Switch between networks
// ============================================
// Active: Phone Hotspot (10.199.210.137)
// Commented: WiFi Network (192.168.1.4)
// To switch: Comment/uncomment the active line below
// ============================================

// Backend server URL - use your server's IP address
// Phone Hotspot - ACTIVE
//export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://10.199.210.137:3001';
// WiFi Network - COMMENTED OUT
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://192.168.1.4:3001';

// Socket.io connection URL (same as backend URL)
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || BACKEND_URL;