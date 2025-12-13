import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

const app = express();

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load SSL certificates, fallback to HTTP if not available
let httpsOptions = null;
let useHttps = false;

// ============================================
// NETWORK IP CONFIGURATION - Switch between networks
// ============================================
// Active: Phone Hotspot (10.199.210.137)
// Commented: WiFi Network (192.168.1.4)
// To switch: Comment/uncomment the active lines below
// ============================================

try {
  // Phone Hotspot - ACTIVE
  const keyPath = path.resolve(__dirname, '10.199.210.137-key.pem');
  const certPath = path.resolve(__dirname, '10.199.210.137.pem');
  
  // WiFi Network - COMMENTED OUT
  //const keyPath = path.resolve(__dirname, '192.168.1.4-key.pem');
  //const certPath = path.resolve(__dirname, '192.168.1.4.pem');
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    useHttps = true;
    console.log('✅ SSL certificates loaded successfully');
  } else {
    console.log('⚠️ SSL certificates not found, using HTTP server');
    console.log('   Looking for:', keyPath);
    console.log('   Looking for:', certPath);
  }
} catch (error) {
  console.error('⚠️ Error loading SSL certificates:', error.message);
  console.log('   Falling back to HTTP server');
}

// Server configuration
// Use 0.0.0.0 to accept connections from any IP on the network
// Or set SERVER_HOST env var to your specific IP if needed
const SERVER_HOST = process.env.SERVER_HOST || '0.0.0.0';
const SERVER_PORT = process.env.PORT || 3001;

// Frontend URLs allowed for CORS
// Phone Hotspot - ACTIVE
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://10.199.210.137';
// WiFi Network - COMMENTED OUT
//const FRONTEND_URL = process.env.FRONTEND_URL || 'https://192.168.1.4:5173';

const FRONTEND_URLS = [
  FRONTEND_URL,
  'http://localhost:5173',
  'https://localhost:5173',
  // Phone Hotspot - ACTIVE
  'http://10.199.210.137:5173',
  'https://10.199.210.137:5173',
  // WiFi Network - COMMENTED OUT
  //'http://192.168.1.4:5173',
  //'https://192.168.1.4:5173'
];

// Python sign language service (always runs on the backend machine)
// Frontend devices never call this directly; they go via this Node backend.
const SIGN_SERVICE_URL = process.env.SIGN_SERVICE_URL || 'http://localhost:5000';

// Create HTTP or HTTPS server based on certificate availability
const server = useHttps 
  ? createHttpsServer(httpsOptions, app)
  : createHttpServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URLS,
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ['websocket', 'polling']
});

// Express setup
app.use(cors({
  origin: FRONTEND_URLS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// Allow larger JSON body for base64-encoded image frames
app.use(express.json({ limit: '10mb' }));

// Store rooms, participants, messages
const rooms = new Map();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Health check for sign language service
app.get('/api/sign-service-health', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    try {
      const pythonResponse = await fetch(`${SIGN_SERVICE_URL}/api/health`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (pythonResponse.ok) {
        const data = await pythonResponse.json().catch(() => ({ status: 'ok' }));
        return res.json({ 
          status: 'available',
          pythonService: data 
        });
      } else {
        return res.status(503).json({ 
          status: 'unavailable',
          error: `Python service returned ${pythonResponse.status}` 
        });
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        return res.status(504).json({ 
          status: 'unavailable',
          error: 'Python service health check timed out' 
        });
      } else if (fetchError.code === 'ECONNREFUSED') {
        return res.status(503).json({ 
          status: 'unavailable',
          error: 'Python service is not running on port 5000' 
        });
      } else {
        return res.status(503).json({ 
          status: 'unavailable',
          error: `Cannot connect to Python service: ${fetchError.message}` 
        });
      }
    }
  } catch (error) {
    return res.status(500).json({ 
      status: 'error',
      error: error.message 
    });
  }
});

// Proxy endpoint: forward sign-language prediction requests to Python service
app.post('/api/predict-sign', async (req, res) => {
  try {
    if (!req.body || !req.body.image) {
      console.error('[Sign Service] No image provided in request');
      return res.status(400).json({
        success: false,
        error: 'No image provided in request body'
      });
    }

    console.log(`[Sign Service] Forwarding request to Python service at ${SIGN_SERVICE_URL}/api/predict-sign`);
    const imageSize = req.body.image ? req.body.image.length : 0;
    console.log(`[Sign Service] Image size: ${(imageSize / 1024).toFixed(2)} KB`);

    // Forward to Python service with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    let pythonResponse;
    try {
      pythonResponse = await fetch(`${SIGN_SERVICE_URL}/api/predict-sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: req.body.image }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error('[Sign Service] Request to Python service timed out after 30 seconds');
        return res.status(504).json({
          success: false,
          error: 'Sign language service request timed out'
        });
      } else if (fetchError.code === 'ECONNREFUSED') {
        console.error(`[Sign Service] Connection refused to ${SIGN_SERVICE_URL} - is the Python service running?`);
        return res.status(503).json({
          success: false,
          error: 'Sign language service is not running. Please start the Python service on port 5000.'
        });
      } else if (fetchError.code === 'ENOTFOUND' || fetchError.code === 'EAI_AGAIN') {
        console.error(`[Sign Service] Cannot resolve host ${SIGN_SERVICE_URL}`);
        return res.status(503).json({
          success: false,
          error: 'Cannot connect to sign language service'
        });
      } else {
        console.error(`[Sign Service] Network error: ${fetchError.message} (code: ${fetchError.code})`);
        return res.status(503).json({
          success: false,
          error: `Network error: ${fetchError.message}`
        });
      }
    }

    let data;
    try {
      data = await pythonResponse.json();
    } catch (jsonError) {
      console.error('[Sign Service] Failed to parse Python service response:', jsonError.message);
      const textResponse = await pythonResponse.text();
      console.error('[Sign Service] Raw response:', textResponse.substring(0, 200));
      return res.status(500).json({
        success: false,
        error: 'Invalid response from sign language service'
      });
    }

    if (!pythonResponse.ok) {
      console.error(`[Sign Service] Python service returned error: ${pythonResponse.status}`, data);
      return res.status(pythonResponse.status >= 400 && pythonResponse.status < 600 ? pythonResponse.status : 500).json({
        success: false,
        error: data && data.error ? data.error : `Python service error: ${pythonResponse.status}`
      });
    }

    console.log(`[Sign Service] Successfully received prediction: ${data.prediction || 'N/A'} (confidence: ${data.confidence || 'N/A'})`);
    // Pass through Python service response as-is
    return res.status(200).json(data);
  } catch (error) {
    console.error('[Sign Service] Unexpected error:', error.message);
    console.error('[Sign Service] Stack:', error.stack);
    return res.status(500).json({
      success: false,
      error: `Sign language service error: ${error.message}`
    });
  }
});

app.post('/api/create-room', (req, res) => {
  const roomId = uuidv4().split('-')[0];
  rooms.set(roomId, {
    participants: new Map(),
    messages: [],
    createdAt: new Date()
  });
  res.json({ roomId });
});

// Socket.io handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomId, userId, userName }) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        participants: new Map(),
        messages: [],
        createdAt: new Date()
      });
    }

    const room = rooms.get(roomId);
    room.participants.set(socket.id, {
      userId,
      userName,
      socketId: socket.id
    });

    socket.to(roomId).emit('user-joined', {
      userId,
      userName,
      socketId: socket.id
    });

    const existingParticipants = Array.from(room.participants.values())
      .filter(p => p.socketId !== socket.id);

    socket.emit('existing-participants', existingParticipants);
    socket.emit('chat-history', room.messages || []);
  });

  socket.on('offer', ({ offer, targetSocketId }) => {
    socket.to(targetSocketId).emit('offer', { offer, socketId: socket.id });
  });

  socket.on('answer', ({ answer, targetSocketId }) => {
    socket.to(targetSocketId).emit('answer', { answer, socketId: socket.id });
  });

  socket.on('ice-candidate', ({ candidate, targetSocketId }) => {
    socket.to(targetSocketId).emit('ice-candidate', { candidate, socketId: socket.id });
  });

  socket.on('toggle-audio', ({ roomId, audioEnabled }) => {
    socket.to(roomId).emit('user-audio-changed', { socketId: socket.id, audioEnabled });
  });

  socket.on('toggle-video', ({ roomId, videoEnabled }) => {
    socket.to(roomId).emit('user-video-changed', { socketId: socket.id, videoEnabled });
  });

  socket.on('chat-message', ({ roomId, message, userName, userId, timestamp }) => {
    if (!roomId || !message) return;
    const payload = {
      message,
      userName: userName || 'Anonymous',
      userId: userId || null,
      socketId: socket.id,
      timestamp: timestamp || Date.now()
    };
    const room = rooms.get(roomId);
    if (room) {
      room.messages.push(payload);
      if (room.messages.length > 200) {
        room.messages = room.messages.slice(-200);
      }
    }
    io.to(roomId).emit('chat-message', payload);
  });

  socket.on('caption', ({ roomId, caption, userName, userId }) => {
    if (!roomId || !caption) return;
    const payload = {
      caption,
      userName: userName || 'Anonymous',
      userId: userId || null,
      socketId: socket.id,
      timestamp: Date.now()
    };
    socket.to(roomId).emit('caption', payload);
  });

  // Broadcast sign language state (sequence / sentence) to everyone in the room
  socket.on('sign-language', ({ roomId, sequence, text, sentence, userName, userId }) => {
    if (!roomId) return;

    const payload = {
      sequence: sequence || '',
      text: text || '',
      sentence: Array.isArray(sentence) ? sentence : [],
      userName: userName || 'Anonymous',
      userId: userId || null,
      socketId: socket.id,
      timestamp: Date.now()
    };

    // Broadcast to all participants in the room (including sender for consistent UI)
    io.to(roomId).emit('sign-language', payload);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const [roomId, room] of rooms.entries()) {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        socket.to(roomId).emit('user-left', { socketId: socket.id });
        if (room.participants.size === 0) rooms.delete(roomId);
        break;
      }
    }
  });
});

// Start server
const protocol = useHttps ? 'https' : 'http';
const displayHost = SERVER_HOST === '0.0.0.0' ? 'localhost/any IP' : SERVER_HOST;
server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`🚀 Server running at ${protocol}://${displayHost}:${SERVER_PORT}`);
  // Phone Hotspot - ACTIVE
  console.log(`   Accessible from: ${protocol}://10.241.227.137:${SERVER_PORT} (or any device on your network)`);
  // WiFi Network - COMMENTED OUT
  // console.log(`   Accessible from: ${protocol}://192.168.1.8:${SERVER_PORT} (or any device on your network)`);
  console.log(`Accepting connections from frontend: ${FRONTEND_URLS.join(', ')}`);
  if (!useHttps) {
    console.log('⚠️  Note: Server is running on HTTP. For HTTPS, add SSL certificates to backend directory.');
    // Phone Hotspot - ACTIVE
    console.log('   Certificate files needed: 10.241.227.137-key.pem and 10.241.227.137.pem');
    // WiFi Network - COMMENTED OUT
    // console.log('   Certificate files needed: 192.168.1.8-key.pem and 192.168.1.8.pem');
  }
});