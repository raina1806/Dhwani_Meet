import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

const app = express();

// Server configuration
const SERVER_HOST = process.env.SERVER_HOST || 'localhost';
const SERVER_PORT = process.env.PORT || 3001;
const SIGN_LANGUAGE_SERVICE_URL = process.env.SIGN_LANGUAGE_SERVICE_URL || 'http://localhost:5000';

// Frontend URLs allowed for CORS
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const FRONTEND_URLS = [
  FRONTEND_URL,
  'http://localhost:5173'
];

// Create HTTP server
const server = createHttpServer(app);

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
// Increase JSON body size limit to handle large base64 image data (PNG images can be large)
app.use(express.json({ limit: '10mb' }));

// Store rooms, participants, messages
const rooms = new Map();

// Track sign language service availability
let signLanguageServiceAvailable = false;
let lastErrorLogTime = 0;
const ERROR_LOG_INTERVAL = 60000; // Log errors at most once per minute

// Check if sign language service is available
const checkSignLanguageService = async () => {
  try {
    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch(`${SIGN_LANGUAGE_SERVICE_URL}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      if (!signLanguageServiceAvailable) {
        console.log('✅ Sign language recognition service is available');
      }
      signLanguageServiceAvailable = true;
      return true;
    }
  } catch (error) {
    // Service not available - silently handle (don't log on every check)
    signLanguageServiceAvailable = false;
    return false;
  }
  signLanguageServiceAvailable = false;
  return false;
};

// Check service availability on startup and periodically
checkSignLanguageService();
setInterval(checkSignLanguageService, 30000); // Check every 30 seconds

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    signLanguageServiceAvailable 
  });
});

// Proxy endpoint for sign language recognition
app.post('/api/predict-sign', async (req, res) => {
  // Check service availability first
  if (!signLanguageServiceAvailable) {
    return res.status(503).json({
      success: false,
      error: 'Sign language recognition service is not available. Please ensure the Python service is running on port 5000.',
    });
  }

  try {
    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${SIGN_LANGUAGE_SERVICE_URL}/api/predict-sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Service returned status ${response.status}`);
    }

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    // Only log errors periodically to avoid spam
    const now = Date.now();
    if (now - lastErrorLogTime > ERROR_LOG_INTERVAL) {
      console.warn('⚠️  Sign language service unavailable:', error.message);
      console.warn('   Make sure to start the Python service: python backend/sign_language_service.py');
      lastErrorLogTime = now;
    }
    
    // Mark service as unavailable
    signLanguageServiceAvailable = false;
    
    res.status(503).json({
      success: false,
      error: 'Sign language recognition service is not available',
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

  socket.on('sign-language', ({ roomId, sequence, text, userName, userId }) => {
    if (!roomId) return;
    const payload = {
      sequence: sequence || '',
      text: text || '',
      userName: userName || 'Anonymous',
      userId: userId || null,
      socketId: socket.id,
      timestamp: Date.now()
    };
    // Broadcast to all participants in the room (including sender for consistency)
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
server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`🚀 Server running at http://${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`Accepting connections from frontend: ${FRONTEND_URLS.join(', ')}`);
  console.log(`📡 Sign language service: ${SIGN_LANGUAGE_SERVICE_URL}`);
  console.log(`   Status: ${signLanguageServiceAvailable ? '✅ Available' : '❌ Not available'}`);
  if (!signLanguageServiceAvailable) {
    console.log(`   To enable sign language recognition, run: python backend/sign_language_service.py`);
  }
});
