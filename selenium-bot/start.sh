#!/bin/bash

# ─── Mode: SETUP (ครั้งแรก — เปิด VNC ให้ login QR) ───
if [ "$MODE" = "setup" ]; then
    echo "🖥️  Setup Mode — เปิด VNC สำหรับ login"
    echo "📺 เข้าถึงผ่าน browser: http://localhost:6080/vnc.html"

    # Start virtual display
    export DISPLAY=:99
    Xvfb :99 -screen 0 1280x900x24 &
    sleep 1
    fluxbox &

    # Start VNC
    x11vnc -display :99 -nopw -forever -shared &
    websockify --web /usr/share/novnc 6080 localhost:5900 &

    # Start bot (ไม่ headless — เห็นหน้าจอผ่าน VNC)
    HEADLESS=false python bot.py

# ─── Mode: RUN (ปกติ — headless) ─────────────────────
else
    echo "🚀 Production Mode — Headless"
    HEADLESS=true python bot.py
fi
