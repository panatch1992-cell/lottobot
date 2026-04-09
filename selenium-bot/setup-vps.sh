#!/bin/bash
# ─── LottoBot VPS Setup Script ───────────────────────
# รันบน Ubuntu 22.04+ VPS:
# curl -fsSL https://raw.githubusercontent.com/panatch1992-cell/lottobot/main/selenium-bot/setup-vps.sh | bash

set -e
echo "🚀 LottoBot VPS Setup"

# ─── 1. Install Docker ───────────────────────────────
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# ─── 2. Install Docker Compose ───────────────────────
if ! command -v docker compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
    echo "✅ Docker Compose installed"
else
    echo "✅ Docker Compose already installed"
fi

# ─── 3. Clone repo ───────────────────────────────────
if [ ! -d "/opt/lottobot" ]; then
    echo "📥 Cloning LottoBot..."
    sudo git clone https://github.com/panatch1992-cell/lottobot.git /opt/lottobot
    sudo chown -R $USER:$USER /opt/lottobot
else
    echo "📥 Updating LottoBot..."
    cd /opt/lottobot && git pull
fi

# ─── 4. Build + Start (Setup Mode) ──────────────────
cd /opt/lottobot/selenium-bot
echo "🔨 Building Docker image..."
docker compose up -d --build

echo ""
echo "=========================================="
echo "  ✅ LottoBot Selenium Bot installed!"
echo ""
echo "  📺 Login LINE Web (ครั้งแรก):"
echo "     http://$(curl -s ifconfig.me):6080/vnc.html"
echo ""
echo "  🔗 API:"
echo "     http://$(curl -s ifconfig.me):8080/health"
echo ""
echo "  หลัง login สำเร็จ เปลี่ยน production mode:"
echo "     cd /opt/lottobot/selenium-bot"
echo "     sed -i 's/MODE=setup/MODE=run/' docker-compose.yml"
echo "     sed -i 's/HEADLESS=false/HEADLESS=true/' docker-compose.yml"
echo "     docker compose down && docker compose up -d"
echo "=========================================="
