# Sign Language Recognition Service Setup

## Quick Start

The sign language service needs to be running separately from the Node.js backend.

### Step 1: Install Python Dependencies (if not already done)
```bash
cd backend
pip install -r requirements.txt
```

### Step 2: Start the Sign Language Service

**Option A: Using the batch file (Windows) - RECOMMENDED**
```bash
cd backend
start_sign_language_service.bat
```
This will automatically activate the virtual environment and run the service.

**Option B: Using venv Python directly**
```bash
cd backend
venv\Scripts\python.exe sign_language_service.py
```

**Option C: Manual activation (Windows)**
```bash
cd backend
venv\Scripts\activate
python sign_language_service.py
```

**Option D: Using the shell script (Linux/Mac)**
```bash
cd backend
chmod +x start_sign_language_service.sh
./start_sign_language_service.sh
```

### Step 3: Verify the Service is Running

You should see output like:
```
Loading model from D:\Raina_2025\dhwanifinal\dhwanifinal\backend\models\converted_model_fixed.h5
[OK] Model loaded successfully
[OK] Labels loaded successfully - 26 classes: ['A', 'B', 'C', ...]
[OK] Normalization parameters loaded successfully
[INFO] Starting Sign Language Recognition Service...
[INFO] Server running on http://localhost:5000
```

### Step 4: Check Backend Status

Once the Python service is running, the Node.js backend will automatically detect it within 30 seconds. You should see:
```
✅ Sign language recognition service is available
```

## Troubleshooting

### Service shows "Not Available"

1. **Check if Python service is running**: Make sure the Python service is running on port 5000
2. **Check if models are in the right place**: Models should be in `backend/models/`:
   - `converted_model_fixed.h5`
   - `labels.json`
   - `norm_params.pkl` (optional - may not be needed for new model)
3. **Check Python dependencies**: Ensure all packages are installed:
   ```bash
   pip install -r backend/requirements.txt
   ```
4. **Check port 5000**: Make sure port 5000 is not being used by another application

### Common Issues

- **Model loading fails**: Check that all model files are in `backend/models/` directory
- **Port 5000 already in use**: Change the port in `sign_language_service.py` and update `SERVER_PORT` in `server.js`
- **Import errors**: Make sure all Python packages are installed correctly

## Running All Services

To run the complete application, you need **3 terminals**:

**Terminal 1 - Backend (Node.js)**
```bash
cd backend
npm start
```

**Terminal 2 - Python Sign Language Service**
```bash
cd backend
python sign_language_service.py
```

**Terminal 3 - Frontend**
```bash
cd frontend
npm run dev
```

## Notes

- The Python service must be running before using sign language recognition in the video call
- The service will be automatically detected by the backend within 30 seconds
- If the service is not running, sign language recognition will be disabled but the video call will still work

