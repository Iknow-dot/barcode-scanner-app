FROM python:3.12-slim

# Install dependencies in one step and clean up
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzbar0 libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first to leverage Docker caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose port (optional, but good practice)
EXPOSE 8080

# Start the application
CMD ["gunicorn", "-b", "0.0.0.0:8080", "run:app"]
