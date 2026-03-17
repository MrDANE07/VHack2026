#!/bin/bash
cd "$(dirname "$0")"

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/Scripts/activate
fi

# Install dependencies if needed
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt 2>/dev/null
fi

# Start the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload