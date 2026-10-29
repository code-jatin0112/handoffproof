# Stage 1: Build the React frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Python FastAPI backend
FROM python:3.12-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend application
COPY backend/ ./backend/

# Copy built frontend production artifacts from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Port and runtime configuration
ENV PORT=8000
ENV HOST=0.0.0.0
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# Start unified service
CMD ["sh", "-c", "python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
