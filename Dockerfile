FROM python:3.12-slim

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzbar0 libgl1-mesa-glx build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project (this includes run.py and other source files)
COPY . .

# Expose port
EXPOSE 8080

# Start the application with auto-reload
CMD ["gunicorn", "-b", "0.0.0.0:8080", "run:app"]
