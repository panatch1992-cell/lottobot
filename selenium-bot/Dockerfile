FROM python:3.12-slim

# Install Chrome
RUN apt-get update && apt-get install -y \
    wget gnupg2 unzip curl \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install ChromeDriver
RUN CHROME_VERSION=$(google-chrome --version | grep -oP '\d+\.\d+\.\d+') \
    && wget -q "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}.0/linux64/chromedriver-linux64.zip" \
    && unzip chromedriver-linux64.zip \
    && mv chromedriver-linux64/chromedriver /usr/local/bin/ \
    && chmod +x /usr/local/bin/chromedriver \
    && rm -rf chromedriver-linux64*

# Install noVNC (สำหรับ login QR ครั้งแรก)
RUN apt-get update && apt-get install -y \
    x11vnc xvfb fluxbox novnc websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Volumes สำหรับเก็บ Chrome profile (session)
VOLUME ["/app/chrome-profile", "/app/screenshots"]

# Script สำหรับเริ่มทั้ง VNC + Bot
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080 6080

CMD ["/start.sh"]
