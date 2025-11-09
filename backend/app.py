"""
Sign Language Recognition Service (Flask)
- MediaPipe for hand detection
- TensorFlow/Keras model for ISL alphabet recognition (landmark-based)
- Live sentence builder per client (temporal smoothing, commit rules, simple word correction)
"""

import os
import sys
import json
import base64
import time
import uuid
from collections import deque, defaultdict
from typing import List, Tuple

import numpy as np
import cv2
from flask import Flask, request, jsonify
from flask_cors import CORS
import tensorflow as tf
from tensorflow import keras

# Try import mediapipe
try:
    import mediapipe as mp
except Exception as e:
    print("ERROR: mediapipe is not installed. Run: pip install mediapipe opencv-python")
    raise

# -------------------------
# App + model config
# -------------------------
app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)

MODEL_PATH = os.path.join(MODELS_DIR, "converted_model_fixed.h5")
LABELS_PATH = os.path.join(MODELS_DIR, "labels.json")
WORDLIST_PATH = os.path.join(MODELS_DIR, "wordlist.txt")
COLLECT_LANDMARK_DIR = os.path.join(BASE_DIR, "collected_landmarks")
os.makedirs(COLLECT_LANDMARK_DIR, exist_ok=True)

# Mediapipe hands (used for both realtime extraction and server-side image processing)
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
# We use static_image_mode=True when processing single images via the API
hands = mp_hands.Hands(static_image_mode=True, max_num_hands=2, min_detection_confidence=0.5, min_tracking_confidence=0.5)

# Globals
model = None
labels: List[str] = []
model_input_dim = None  # 63 or 126 for landmark models

# -------------------------
# Load model / labels
# -------------------------
def load_labels(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as f:
        obj = json.load(f)
    if isinstance(obj, dict) and "classes" in obj:
        return obj["classes"]
    if isinstance(obj, dict):
        items = sorted(obj.items(), key=lambda kv: int(kv[0]))
        return [v for _, v in items]
    if isinstance(obj, list):
        return obj
    raise ValueError("Unsupported labels.json format")

def model_input_info(m: tf.keras.Model) -> Tuple[bool, Tuple]:
    ishape = m.input_shape
    if isinstance(ishape, list):
        ishape = ishape[0]
    dims = [d for d in ishape if d is not None]
    if len(dims) == 1:
        return True, (dims[0],)
    elif len(dims) == 3:
        return False, (dims[0], dims[1], dims[2])
    else:
        raise ValueError(f"Unsupported input shape: {ishape}")

def load_model_and_labels():
    global model, labels, model_input_dim
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model not found at {MODEL_PATH}")
    print("Loading model:", MODEL_PATH)
    model = keras.models.load_model(MODEL_PATH, compile=False)
    print("Loaded model.")
    # input info
    is_landmark, in_shape = model_input_info(model)
    if is_landmark:
        model_input_dim = in_shape[0]
        print(f"Model expects landmark vector dim: {model_input_dim}")
    else:
        model_input_dim = None
        print(f"Model expects image input shape: {in_shape}")
    # labels
    if not os.path.exists(LABELS_PATH):
        raise FileNotFoundError(f"labels.json not found at {LABELS_PATH}")
    labels_list = load_labels(LABELS_PATH)
    print(f"Loaded {len(labels_list)} labels.")
    return model, labels_list

# load at startup
try:
    model, labels = load_model_and_labels()
except Exception as e:
    print("Error loading model or labels:", e)
    model = None
    labels = []

# -------------------------
# Landmark extraction / normalization
# -------------------------
def normalize_landmarks(lm_list: List[float]) -> List[float]:
    """
    lm_list: flat [x,y,z,...] for 21 landmarks (63 floats)
    translate so wrist (index 0) at origin, scale by max L2 distance
    returns flattened list (63 floats)
    """
    arr = np.array(lm_list, dtype=np.float32).reshape(-1, 3)
    wrist = arr[0].copy()
    arr -= wrist
    max_dist = np.max(np.linalg.norm(arr, axis=1))
    if max_dist > 0:
        arr /= max_dist
    return arr.flatten().tolist()

def extract_hand_landmarks_from_image_bgr(image_bgr: np.ndarray):
    """
    Process a BGR image (OpenCV) with MediaPipe (static_image mode).
    Returns features list (63 or 126 floats) or None if no hands detected.
    """
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    results = hands.process(image_rgb)
    if not results.multi_hand_landmarks:
        return None, False  # no hands detected

    left_hand = None
    right_hand = None
    for hand_landmarks, handedness in zip(results.multi_hand_landmarks, results.multi_handedness):
        lm_flat = []
        for lm in hand_landmarks.landmark:
            lm_flat.extend([lm.x, lm.y, lm.z])
        lm_norm = normalize_landmarks(lm_flat)
        label = handedness.classification[0].label  # "Left" or "Right"
        if label == "Left":
            left_hand = lm_norm
        else:
            right_hand = lm_norm

    if left_hand is None:
        left_hand = [0.0] * 63
    if right_hand is None:
        right_hand = [0.0] * 63

    feats = left_hand + right_hand  # always produce 126 features by default
    # If model expects 63, we will pick the "bigger" hand downstream
    return feats, True

# -------------------------
# Collection endpoint (landmarks)
# -------------------------
@app.route('/api/collect-landmark', methods=['POST'])
def collect_landmark():
    """
    Accepts JSON:
      { "label": "A", "landmarks": [x..] }
    or legacy { "label":"A", "x": [...] }
    Saves numpy + json files under collected_landmarks/<label>/
    """
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({'success': False, 'error': 'No JSON body'}), 400
        label = data.get('label')
        if not label:
            return jsonify({'success': False, 'error': 'No label provided'}), 400
        landmarks = data.get('landmarks') or data.get('x')
        if landmarks is None:
            return jsonify({'success': False, 'error': 'No landmarks provided'}), 400
        landmarks = list(map(float, landmarks))
        if len(landmarks) == 63:
            landmarks = landmarks + [0.0]*63
        if len(landmarks) != 126:
            return jsonify({'success': False, 'error': 'landmarks must be length 63 or 126'}), 400
        class_dir = os.path.join(COLLECT_LANDMARK_DIR, label)
        os.makedirs(class_dir, exist_ok=True)
        uid = uuid.uuid4().hex
        npy_path = os.path.join(class_dir, f"{uid}.npy")
        json_path = os.path.join(class_dir, f"{uid}.json")
        np.save(npy_path, np.asarray(landmarks, dtype=np.float32))
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump({'x': landmarks, 'label': label}, f)
        return jsonify({'success': True, 'npy': npy_path, 'json': json_path}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# -------------------------
# Session & sentence builder
# -------------------------
# Configurable parameters
SMOOTH_WINDOW = 8
HOLD_FRAMES = 6
WORD_PAUSE_SECONDS = 1.2
MIN_CONFIDENCE_TO_ACCEPT = 0.5  # tune as needed

# in-memory sessions (client_id -> state)
sessions = defaultdict(lambda: {
    "pred_hist": deque(maxlen=SMOOTH_WINDOW),  # (label_idx, conf, ts)
    "stable_label": None,
    "stable_count": 0,
    "last_hand_ts": time.time(),
    "committed_letters": [],  # list of chars
    "sentence": ""            # built sentence string
})

# optional wordlist for correction
wordlist = []
if os.path.exists(WORDLIST_PATH):
    with open(WORDLIST_PATH, 'r', encoding='utf-8') as f:
        wordlist = [w.strip().lower() for w in f if w.strip()]
    # optionally trim by frequency/commonness
    # wordlist = wordlist[:20000]
else:
    print("[INFO] No wordlist found at", WORDLIST_PATH, "- word correction disabled")

import difflib

def majority_vote_label(pred_hist):
    if not pred_hist:
        return None, 0.0
    counts = {}
    confs = {}
    for lbl, conf, ts in pred_hist:
        if lbl is None:
            continue
        if conf < MIN_CONFIDENCE_TO_ACCEPT:
            continue
        counts[lbl] = counts.get(lbl, 0) + 1
        confs.setdefault(lbl, []).append(conf)
    if not counts:
        return None, 0.0
    best = max(counts.items(), key=lambda kv: (kv[1], sum(confs.get(kv[0], []))))
    lbl = best[0]
    avg_conf = float(sum(confs[lbl]) / len(confs[lbl]))
    return lbl, avg_conf

def correct_last_word(client_id, max_suggestions=3):
    s = sessions[client_id]
    sent = s["sentence"].rstrip()
    if not sent or not wordlist:
        return None
    parts = sent.split(" ")
    last = parts[-1].lower()
    if not last:
        return None
    candidates = difflib.get_close_matches(last, wordlist, n=max_suggestions, cutoff=0.7)
    if candidates:
        best = candidates[0]
        parts[-1] = best
        new_sent = " ".join(parts) + (" " if s["sentence"].endswith(" ") else "")
        s["sentence"] = new_sent
        return best
    return None

def session_add_frame(client_id, label_idx, confidence, hand_present):
    s = sessions[client_id]
    ts = time.time()
    if hand_present:
        s["last_hand_ts"] = ts
    s["pred_hist"].append((label_idx, float(confidence) if confidence is not None else 0.0, ts))
    stable_lbl, avg_conf = majority_vote_label(s["pred_hist"])
    if stable_lbl is None:
        s["stable_label"] = None
        s["stable_count"] = 0
    else:
        if s["stable_label"] == stable_lbl:
            s["stable_count"] += 1
        else:
            s["stable_label"] = stable_lbl
            s["stable_count"] = 1
    committed = None
    if s["stable_label"] is not None and s["stable_count"] >= HOLD_FRAMES:
        committed = s["stable_label"]
        s["stable_label"] = None
        s["stable_count"] = 0
        s["pred_hist"].clear()
        if labels and committed < len(labels):
            ch = labels[committed]
        else:
            ch = str(committed)
        # collapse repeats
        if not s["committed_letters"] or s["committed_letters"][-1] != ch:
            s["committed_letters"].append(ch)
            s["sentence"] += ch
    # word boundary
    time_since_hand = ts - s["last_hand_ts"]
    if time_since_hand >= WORD_PAUSE_SECONDS and s["committed_letters"]:
        if not s["sentence"].endswith(" "):
            s["sentence"] += " "
        correct_last_word(client_id)
    return committed

def get_session_sentence(client_id):
    return sessions[client_id]["sentence"]

# -------------------------
# Health endpoint
# -------------------------
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'model_loaded': model is not None,
        'labels_loaded': bool(labels),
        'labels_count': len(labels),
        'wordlist_loaded': bool(wordlist)
    })

# -------------------------
# Prediction endpoint
# -------------------------
@app.route('/api/predict-sign', methods=['POST'])
def predict_sign_endpoint():
    """
    POST: file upload under 'image' or JSON body with 'image' base64 string.
    Optional: provide client id in header 'X-Client-Id' or JSON 'client_id'.
    Returns: prediction (label), confidence, committed_letter_idx (if any), and full sentence.
    """
    try:
        # load image
        image = None
        if 'image' in request.files:
            f = request.files['image']
            arr = np.frombuffer(f.read(), np.uint8)
            image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        else:
            body = request.get_json(silent=True) or {}
            if 'image' in body:
                imdata = body['image']
                if imdata.startswith('data:image'):
                    imdata = imdata.split(',')[1]
                b = base64.b64decode(imdata)
                arr = np.frombuffer(b, np.uint8)
                image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if image is None:
            return jsonify({'success': False, 'error': 'No image provided'}), 400

        # optional resizing (keep reasonable size for MediaPipe)
        h, w = image.shape[:2]
        max_dim = 1280
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            image = cv2.resize(image, (int(w*scale), int(h*scale)), interpolation=cv2.INTER_AREA)

        feats, hand_present = extract_hand_landmarks_from_image_bgr(image)
        if feats is None:
            # no hands detected: update session so that word-boundary detection can occur
            client_id = request.headers.get('X-Client-Id') or (request.json or {}).get('client_id') or 'default'
            session_add_frame(client_id, None, 0.0, False)
            return jsonify({'success': True, 'prediction': None, 'confidence': 0.0, 'committed_letter_idx': None, 'sentence': get_session_sentence(client_id)}), 200

        # If model expects 63, pick biggest hand
        feats_arr = np.array(feats, dtype=np.float32)
        if model_input_dim == 63:
            left = feats_arr[:63]
            right = feats_arr[63:]
            if np.count_nonzero(left) >= np.count_nonzero(right):
                use = left
            else:
                use = right
            X = use.reshape(1, -1)
        else:
            X = feats_arr.reshape(1, -1)
            # if model_input_dim is set but different, pad/truncate
            if model_input_dim is not None and X.shape[1] != model_input_dim:
                if X.shape[1] < model_input_dim:
                    pad = np.zeros((1, model_input_dim - X.shape[1]), dtype=np.float32)
                    X = np.concatenate([X, pad], axis=1)
                elif X.shape[1] > model_input_dim:
                    X = X[:, :model_input_dim]

        # ensure float32
        X = X.astype(np.float32)

        # predict
        preds = model.predict(X, verbose=0)
        idx = int(np.argmax(preds[0]))
        confidence = float(preds[0][idx])

        predicted_label = labels[idx] if labels and idx < len(labels) else str(idx)

        # session update
        client_id = request.headers.get('X-Client-Id') or (request.json or {}).get('client_id') or 'default'
        committed = session_add_frame(client_id, idx, confidence, True)
        sentence = get_session_sentence(client_id)

        return jsonify({
            'success': True,
            'prediction': str(predicted_label),
            'confidence': float(confidence),
            'committed_letter_idx': int(committed) if committed is not None else None,
            'sentence': sentence
        }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# -------------------------
# Sentence endpoints
# -------------------------
@app.route('/api/sentence', methods=['GET'])
def get_sentence_endpoint():
    client_id = request.headers.get('X-Client-Id') or request.args.get('client_id') or 'default'
    return jsonify({'sentence': get_session_sentence(client_id)}), 200

@app.route('/api/sentence/reset', methods=['POST'])
def reset_sentence_endpoint():
    client_id = request.headers.get('X-Client-Id') or (request.json or {}).get('client_id') or 'default'
    sessions.pop(client_id, None)
    return jsonify({'ok': True}), 200



# -------------------------
# Run
# -------------------------
if __name__ == '__main__':
    if model is None or not labels:
        try:
            model, labels = load_model_and_labels()
        except Exception as e:
            print("Failed to load model/labels on startup:", e)
            sys.exit(1)
    print("Starting Sign Language Recognition Service on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
