# Python Manual Video Editor Dockerfile
FROM python:3.10-slim

# Install system dependencies (FFmpeg for video editing)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Create persistent directories for uploads/renders/thumbnails
RUN mkdir -p uploads renders thumbnails && chmod 777 uploads renders thumbnails

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
