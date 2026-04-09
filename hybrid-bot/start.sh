#!/bin/bash
set -e

echo "🚀 LottoBot Hybrid System Starting..."

# ─── Setup Mode (ครั้งแรก — VNC สำหรับ QR login) ─────
if [ "$MODE" = "setup" ]; then
    echo "🖥️  Setup Mode — VNC enabled for QR login"
    export DISPLAY=:99
    Xvfb :99 -screen 0 1280x900x24 &
    sleep 1
    fluxbox &
    x11vnc -display :99 -nopw -forever -shared &
    websockify --web /usr/share/novnc 6080 localhost:5900 &
    echo "📺 VNC: http://localhost:6080/vnc.html"
    HEADLESS=false
else
    HEADLESS=true
fi

export HEADLESS

# ─── Start all services ──────────────────────────────
echo "🔧 Starting Scraper Bridge (port 8083)..."
python scraper_bridge.py &

echo "📡 Starting LINE OA Responder (port 8082)..."
python line_oa_responder.py &

echo "🎯 Starting Trigger Bot (port 8081)..."
python trigger_bot.py &

echo ""
echo "=========================================="
echo "  ✅ LottoBot Hybrid System Running!"
echo ""
echo "  🎯 Trigger:   http://localhost:8081/health"
echo "  📡 Responder: http://localhost:8082/health"
echo "  🔧 Bridge:    http://localhost:8083/health"
if [ "$MODE" = "setup" ]; then
echo "  📺 VNC:       http://localhost:6080/vnc.html"
fi
echo "=========================================="

# Wait for all background processes
wait
