# Python Automated Video Service Dockerfile
FROM python:3.10-slim

# Install system dependencies (FFmpeg, OpenCV libs)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsm6 \
    libxext6 \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Ensure /tmp exists (used for jobs)
RUN mkdir -p /tmp && chmod 777 /tmp

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
