// Configuration for API and Socket.io connections
// Update these values based on your backend server location

// Backend server URL - for local development
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Socket.io connection URL (same as backend URL)
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || BACKEND_URL;

