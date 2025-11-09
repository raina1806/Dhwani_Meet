# Configuration Guide

This guide explains how to configure the application for local network access with HTTPS.

## Backend Configuration

The backend server is configured to accept connections from your HTTPS frontend.

### Default Configuration

- **Server Host**: `0.0.0.0` (accepts connections from any IP on the network)
- **Server Port**: `3001`
- **Frontend URLs**: Supports multiple frontend URLs including:
  - `https://192.168.29.36:5173`
  - `http://localhost:5173`
  - `https://localhost:5173`
  - `http://192.168.29.36:5173`

### Environment Variables (Optional)

You can customize the backend using environment variables:

```bash
# Set the server host (default: 0.0.0.0)
SERVER_HOST=0.0.0.0

# Set the server port (default: 3001)
PORT=3001

# Set the primary frontend URL (default: https://192.168.29.36:5173)
FRONTEND_URL=https://192.168.29.36:5173
```

Example:
```bash
PORT=3001 FRONTEND_URL=https://192.168.29.36:5173 node server.js
```

## Frontend Configuration

The frontend uses a configuration file (`frontend/src/config.js`) to manage API and Socket.io connections.

### Default Configuration

- **Backend URL**: `http://192.168.29.36:3001`
- **Socket URL**: Same as Backend URL

### Update Configuration

Edit `frontend/src/config.js` to change the backend server address:

```javascript
// For local development
export const BACKEND_URL = 'http://localhost:3001';

// For local network (replace with your server IP)
export const BACKEND_URL = 'http://192.168.29.36:3001';

// For HTTPS backend (if you add SSL to backend)
export const BACKEND_URL = 'https://192.168.29.36:3001';
```

### Environment Variables (Optional)

You can also use environment variables (Vite format):

Create a `.env` file in the `frontend` directory:

```env
VITE_BACKEND_URL=http://192.168.29.36:3001
VITE_SOCKET_URL=http://192.168.29.36:3001
```

## Testing on Other Devices

1. **Find your server IP address**:
   - Windows: `ipconfig`
   - Mac/Linux: `ifconfig` or `ip addr`
   - Look for your local network IP (usually starts with 192.168.x.x)

2. **Update frontend/config.js**:
   - Set `BACKEND_URL` to your server IP: `http://YOUR_IP:3001`

3. **Start the backend server**:
   ```bash
   cd backend
   npm start
   ```
   The server will listen on `0.0.0.0:3001` (accessible from any device on your network)

4. **Start the frontend**:
   ```bash
   cd frontend
   npm run dev
   ```
   Access from other devices: `https://YOUR_IP:5173`

5. **On other devices**:
   - Open a browser
   - Navigate to `https://YOUR_IP:5173`
   - Accept the SSL certificate warning (if using self-signed certificate)
   - Join a meeting!

## Troubleshooting

### Connection Issues

- **Check firewall**: Ensure port 3001 (backend) and 5173 (frontend) are open
- **Check IP address**: Make sure you're using the correct server IP
- **Check console**: Look for connection errors in browser console
- **CORS errors**: Backend should accept your frontend URL automatically

### Mixed Content Issues

If you see mixed content warnings:
- The frontend is HTTPS but backend is HTTP
- This is usually fine for Socket.io connections
- Consider adding HTTPS to backend if needed

### Socket Connection Fails

- Verify backend is running: Check `http://YOUR_IP:3001/api/health`
- Check backend console for connection logs
- Verify CORS configuration in `backend/server.js`
- Check browser console for connection errors

