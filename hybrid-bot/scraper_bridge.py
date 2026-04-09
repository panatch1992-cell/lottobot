"""
scraper_bridge.py — เชื่อม Vercel Scraper → result.json → Trigger
Vercel cron เรียก endpoint นี้เมื่อเจอผลหวยใหม่
→ บันทึก result.json → trigger_bot เห็นว่ามีอัพเดท → พิมพ์ "." → LINE OA reply
"""

import os
import json
import logging
from pathlib import Path
from datetime import datetime
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("bridge")

RESULT_FILE = os.environ.get("RESULT_FILE", "/app/data/result.json")
HISTORY_FILE = os.environ.get("HISTORY_FILE", "/app/data/history.json")

app = Flask(__name__)


@app.route("/result", methods=["POST"])
def receive_result():
    """รับผลหวยจาก Vercel scraper"""
    data = request.json
    if not data:
        return jsonify({"error": "no data"}), 400

    # บันทึกผลล่าสุด
    Path(RESULT_FILE).parent.mkdir(parents=True, exist_ok=True)
    Path(RESULT_FILE).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # เก็บประวัติ
    history = []
    if Path(HISTORY_FILE).exists():
        try:
            history = json.loads(Path(HISTORY_FILE).read_text(encoding="utf-8"))
        except:
            history = []
    history.insert(0, {**data, "received_at": datetime.now().isoformat()})
    history = history[:100]  # เก็บ 100 รายการ
    Path(HISTORY_FILE).write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")

    log.info(f"✅ Result saved: {json.dumps(data, ensure_ascii=False)[:100]}...")
    return jsonify({"success": True})


@app.route("/result", methods=["GET"])
def get_result():
    """ดูผลล่าสุด"""
    try:
        data = json.loads(Path(RESULT_FILE).read_text(encoding="utf-8"))
        return jsonify(data)
    except:
        return jsonify({"error": "no result yet"})


@app.route("/health")
def health():
    has_result = Path(RESULT_FILE).exists()
    return jsonify({"ok": True, "has_result": has_result})


if __name__ == "__main__":
    port = int(os.environ.get("BRIDGE_PORT", "8083"))
    log.info(f"🚀 Scraper Bridge on port {port}")
    app.run(host="0.0.0.0", port=port)
