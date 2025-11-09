# Google Meet Clone

A simple video conferencing application built with React (Vite) for the frontend and Express.js for the backend, featuring WebRTC for peer-to-peer video communication.

## Features

- 🎥 Real-time video and audio communication
- 🔊 Mute/unmute audio
- 📹 Enable/disable video
- 🖥️ Screen sharing
- 👥 Multiple participants support
- 🎨 Modern, responsive UI with TailwindCSS

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn

## Installation

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

The backend server will run on `http://localhost:3001`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:5173`

## Usage

1. Start both the backend and frontend servers
2. Open `http://localhost:5173` in your browser
3. Enter your name
4. Click "New Meeting" to create a room or enter a Meeting ID to join an existing room
5. Allow camera and microphone permissions when prompted
6. Share the Meeting ID with others to invite them to your meeting

## Technologies Used

- **Frontend:**
  - React 18
  - Vite
  - TailwindCSS
  - Socket.io Client
  - WebRTC API

- **Backend:**
  - Express.js
  - Socket.io
  - Node.js

## Project Structure

```
.
├── backend/
│   ├── server.js          # Express server with Socket.io
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── HomePage.jsx
│   │   │   ├── MeetingRoom.jsx
│   │   │   ├── VideoPlayer.jsx
│   │   │   └── Controls.jsx
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   └── package.json
└── README.md
```

## Notes

- This application uses WebRTC for peer-to-peer communication, which requires HTTPS in production (or localhost for development)
- STUN servers are used for NAT traversal, but for production, you may want to add TURN servers for better connectivity
- Camera and microphone permissions are required for the application to function
