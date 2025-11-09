# Quick Start Guide

## Step-by-Step Setup

### 1. Start the Backend Server

Open a terminal and run:

```bash
cd backend
npm install
npm start
```

You should see: `Server running on port 3001`

**Important:** Keep this terminal open and running!

### 2. Start the Frontend Server

Open a **NEW** terminal window and run:

```bash
cd frontend
npm install
npm run dev
```

You should see the frontend running on `http://localhost:5173`

### 3. Open the Application

Open your browser and go to: `http://localhost:5173`

## Troubleshooting

### "Failed to create meeting" Error

If you see this error, it usually means:

1. **Backend server is not running**
   - Make sure you completed Step 1 above
   - Check the terminal - you should see "Server running on port 3001"
   - If you see errors, make sure you installed dependencies with `npm install`

2. **Port 3001 is already in use**
   - Stop any other application using port 3001
   - Or change the port in `backend/server.js`

3. **Backend dependencies not installed**
   - Go to the `backend` folder
   - Run `npm install` again
   - Make sure there are no errors

### Check if Backend is Running

You can test if the backend is running by opening:
`http://localhost:3001/api/health`

You should see: `{"status":"ok"}`

If you get an error, the backend is not running properly.
