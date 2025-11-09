#!/bin/bash
echo "Starting Sign Language Recognition Service..."
cd "$(dirname "$0")"
source venv/bin/activate
python sign_language_service.py

