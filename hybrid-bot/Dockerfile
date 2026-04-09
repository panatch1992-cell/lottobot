FROM python:3.12-slim

# System deps
RUN apt-get update && apt-get install -y \
    wget gnupg2 curl xvfb x11vnc fluxbox novnc websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright + Chromium
RUN playwright install chromium && playwright install-deps chromium

COPY . .

# Volumes
VOLUME ["/app/browser-profile", "/app/data", "/app/screenshots"]

COPY start.sh /start.sh
RUN chmod +x /start.sh

# Ports: 8081=trigger, 8082=responder, 8083=bridge, 6080=VNC
EXPOSE 8081 8082 8083 6080

CMD ["/start.sh"]
