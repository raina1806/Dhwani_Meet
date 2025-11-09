"""
Sign Language Recognition Service
Uses MediaPipe for hand detection and TensorFlow/Keras model for ISL alphabet recognition
"""

import os
import sys
import json
import base64
import numpy as np
import cv2
from flask import Flask, request, jsonify
from flask_cors import CORS
import tensorflow as tf
from tensorflow import keras
import mediapipe as mp

app = Flask(__name__)
CORS(app)

# Initialize MediaPipe Hands
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
hands = mp_hands.Hands(
    static_image_mode=True,
    max_num_hands=2,  # Allow up to 2 hands for 126 features
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

# Load model and preprocessing files
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, 'models')

MODEL_PATH = os.path.join(MODELS_DIR, 'converted_model_fixed.h5')
LABELS_PATH = os.path.join(MODELS_DIR, 'labels.json')

# Load model and preprocessing components
model = None
labels = None  # List of class labels from labels.json
norm_params = None
model_input_dim = None  # Expected input dimension (63 or 126 for landmark models)

def load_labels(path):
    """
    Supports:
      - {"classes": ["A","B",...]}  OR
      - {"0": "A", "1":"B", ...}    OR
      - ["A","B",...]
    """
    with open(path, "r", encoding="utf-8") as f:
        obj = json.load(f)
    if isinstance(obj, dict) and "classes" in obj:
        labels = obj["classes"]
    elif isinstance(obj, dict):
        # assume index->name mapping
        items = sorted(obj.items(), key=lambda kv: int(kv[0]))
        labels = [name for _, name in items]
    elif isinstance(obj, list):
        labels = obj
    else:
        raise ValueError("Unsupported labels.json format.")
    return labels

def model_input_info(model):
    """
    Returns (is_landmark_model, expected_shape)
    - landmark: (features,) e.g. (126,)
    - image: (H,W,C) e.g. (128,128,3) or (224,224,3)
    """
    ishape = model.input_shape
    if isinstance(ishape, list):
        ishape = ishape[0]
    # ishape typically like (None, 126) or (None, 128, 128, 3)
    dims = [d for d in ishape if d is not None]
    if len(dims) == 1:
        return True, (dims[0],)
    elif len(dims) == 3:
        h, w, c = dims
        if c not in (1, 3):
            raise ValueError(f"Unexpected channels: {c}")
        return False, (h, w, c)
    else:
        raise ValueError(f"Unsupported input shape: {ishape}")

def load_model():
    """Load the trained model and preprocessing files"""
    global model, labels, norm_params, model_input_dim
    
    try:
        print(f"Loading model from {MODEL_PATH}")
        model = keras.models.load_model(MODEL_PATH, compile=False)
        print("[OK] Model loaded successfully")
        
        # Determine model input type and dimensions
        is_landmark_model, in_shape = model_input_info(model)
        if is_landmark_model:
            model_input_dim = in_shape[0]
            print(f"[OK] Model type: LANDMARK features, expected dim: {model_input_dim}")
        else:
            print(f"[OK] Model type: IMAGE, expected size: {in_shape}")
            model_input_dim = None
        
        # Quick sanity check: output dim matches labels length
        try:
            out_shape = model.output_shape
            if isinstance(out_shape, list):
                out_shape = out_shape[0]
            out_dim = [d for d in out_shape if d is not None][-1]
            print(f"[DEBUG] Model output dimension: {out_dim}")
        except Exception:
            print("[WARNING] Couldn't determine model output shape")
        
        print(f"Loading labels from {LABELS_PATH}")
        labels = load_labels(LABELS_PATH)
        print(f"[OK] Labels loaded successfully - {len(labels)} classes: {labels}")
        
        # Verify output dim matches labels (if we could determine it)
        try:
            out_shape = model.output_shape
            if isinstance(out_shape, list):
                out_shape = out_shape[0]
            out_dim = [d for d in out_shape if d is not None][-1]
            if out_dim != len(labels):
                print(f"[WARNING] Model output dim ({out_dim}) != labels count ({len(labels)})")
        except Exception:
            pass
        
        # Don't use norm_params - the standalone code doesn't use them
        norm_params = None
        print("[INFO] Using landmark normalization only (no external norm_params)")
        
        return True
    except Exception as e:
        print(f"[ERROR] Error loading model files: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def normalize_landmarks(lm_list):
    """
    Normalize landmarks: translate to wrist origin, scale by max L2 distance.
    This matches the standalone testing code that works accurately.
    lm_list: flat list [x1,y1,z1,x2,y2,z2,...] for a single hand (63 values)
    Returns: normalized flattened list (63 values) as Python list
    """
    arr = np.array(lm_list, dtype=np.float32).reshape(-1, 3)
    wrist = arr[0].copy()  # Wrist is landmark 0
    arr -= wrist  # Translate so wrist is at origin
    max_dist = np.max(np.linalg.norm(arr, axis=1))
    if max_dist > 0:
        arr /= max_dist  # Scale by max L2 distance
    return arr.flatten().tolist()  # Return as list to match standalone code


def extract_hand_landmarks(image):
    """Extract hand landmarks using MediaPipe
    Returns features as list - matches standalone testing code exactly
    """
    # Convert BGR to RGB
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    
    # Process image with MediaPipe
    results = hands.process(image_rgb)
    
    if not results.multi_hand_landmarks:
        return None
    
    # Extract and normalize landmarks for each hand (matching standalone code)
    left_hand = None
    right_hand = None
    
    for hand_landmarks, handedness in zip(results.multi_hand_landmarks, results.multi_handedness):
        # Extract raw landmarks
        lm_flat = []
        for lm in hand_landmarks.landmark:
            lm_flat.extend([lm.x, lm.y, lm.z])
        
        # Normalize landmarks (translate to wrist, scale by max distance)
        lm_normalized = normalize_landmarks(lm_flat)
        
        # Assign to left or right hand based on MediaPipe classification
        label = handedness.classification[0].label  # "Left" or "Right"
        if label == "Left":
            left_hand = lm_normalized
        else:
            right_hand = lm_normalized
    
    # Pad missing hand(s) with zeros (matching standalone code)
    if left_hand is None:
        left_hand = [0.0] * 63
    if right_hand is None:
        right_hand = [0.0] * 63
    
    # Decide feature vector size based on model input
    feats = left_hand + right_hand  # 126 features (list concatenation)
    
    # If model expects 63 features, choose the biggest hand
    if model_input_dim == 63:
        # Choose hand with more non-zero values
        lh_nz = sum(1 for x in left_hand if abs(x) > 1e-6)
        rh_nz = sum(1 for x in right_hand if abs(x) > 1e-6)
        feats = left_hand if lh_nz >= rh_nz else right_hand
    
    return feats

# Removed normalize_features - standalone code doesn't use external norm_params
# Landmark normalization is done in normalize_landmarks() function

def predict_sign(image):
    """Predict ISL alphabet from image - matches standalone code logic exactly"""
    try:
        # Extract hand landmarks
        feats = extract_hand_landmarks(image)
        
        if feats is None:
            return None, "No hand detected"
        
        # Convert to numpy array for model input
        X = np.array(feats, dtype=np.float32).reshape(1, -1)
        
        # Verify feature dimension matches model input
        if model_input_dim is not None and X.shape[1] != model_input_dim:
            print(f"[WARNING] Feature dim ({X.shape[1]}) != model input dim ({model_input_dim})")
            # Try to adjust
            if X.shape[1] < model_input_dim:
                # Pad with zeros
                padding = np.zeros((1, model_input_dim - X.shape[1]))
                X = np.concatenate([X, padding], axis=1)
            elif X.shape[1] > model_input_dim:
                # Truncate
                X = X[:, :model_input_dim]
        
        # Predict (matching standalone code)
        preds = model.predict(X, verbose=0)
        idx = int(np.argmax(preds[0]))
        score = float(preds[0][idx])
        
        # Decode label using labels.json
        predicted_label = labels[idx] if idx < len(labels) else str(idx)
        
        print(f"[DEBUG] Predicted: {predicted_label} (class {idx}), confidence: {score:.4f}")
        
        return predicted_label, score
        
    except Exception as e:
        print(f"[ERROR] Error in prediction: {str(e)}")
        import traceback
        traceback.print_exc()
        return None, str(e)

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'model_loaded': model is not None,
        'labels_loaded': labels is not None,
        'labels_count': len(labels) if labels else 0,
        'norm_params_loaded': norm_params is not None
    })

@app.route('/api/predict-sign', methods=['POST'])
def predict_sign_endpoint():
    """Predict ISL sign from image"""
    try:
        # Get image from request
        if 'image' in request.files:
            # File upload
            file = request.files['image']
            image_bytes = file.read()
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        elif 'image' in request.json:
            # Base64 encoded image
            image_data = request.json['image']
            if image_data.startswith('data:image'):
                # Remove data URL prefix
                image_data = image_data.split(',')[1]
            image_bytes = base64.b64decode(image_data)
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        else:
            return jsonify({'error': 'No image provided'}), 400
        
        if image is None:
            return jsonify({'error': 'Failed to decode image'}), 400
        
        # Preprocess image for better consistency
        # Resize if too large (MediaPipe works best with reasonable sizes)
        height, width = image.shape[:2]
        max_dimension = 1280
        if width > max_dimension or height > max_dimension:
            scale = max_dimension / max(width, height)
            new_width = int(width * scale)
            new_height = int(height * scale)
            image = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
        
        # Ensure image is in correct format (BGR for OpenCV, which is what we have)
        # MediaPipe expects RGB, but we convert in extract_hand_landmarks
        
        # Predict sign
        predicted_label, confidence_or_error = predict_sign(image)
        
        if predicted_label is None:
            return jsonify({
                'success': False,
                'error': confidence_or_error,
                'prediction': None
            }), 200
        
        return jsonify({
            'success': True,
            'prediction': str(predicted_label),
            'confidence': float(confidence_or_error) if isinstance(confidence_or_error, (int, float)) else 0.0
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    # Load model on startup
    if not load_model():
        print("[ERROR] Failed to load model. Service may not work correctly.")
        sys.exit(1)
    
    # Start Flask server
    print("[INFO] Starting Sign Language Recognition Service...")
    print("[INFO] Server running on http://localhost:5000")
    app.run(host='localhost', port=5000, debug=False)
