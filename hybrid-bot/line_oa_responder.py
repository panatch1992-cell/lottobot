"""
line_oa_responder.py — ตัวตอบ (Responder)
LINE OA Webhook — เมื่อเห็น "." จาก trigger → Reply ผลหวยฟรี
Reply = ฟรี 100% ไม่จำกัดจำนวน!
"""

import os
import json
import hmac
import hashlib
import base64
import logging
from pathlib import Path
from datetime import datetime
from flask import Flask, request, abort, jsonify
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("responder")

# ─── Config ──────────────────────────────────────────
CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "")
CHANNEL_ACCESS_TOKEN = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "")
RESULT_FILE = os.environ.get("RESULT_FILE", "/app/data/result.json")
TRIGGER_CHAR = "."
LINE_API = "https://api.line.me/v2/bot/message/reply"

app = Flask(__name__)
stats = {"replies": 0, "triggers_received": 0, "started_at": datetime.now().isoformat()}


# ─── Signature Verification ──────────────────────────

def verify_signature(body, signature):
    """ตรวจสอบ webhook signature จาก LINE"""
    if not CHANNEL_SECRET:
        return True  # skip ถ้าไม่มี secret (dev mode)
    h = hmac.new(
        CHANNEL_SECRET.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return signature == base64.b64encode(h).decode("utf-8")


# ─── Get Latest Result ───────────────────────────────

def get_latest_result():
    """ดึงผลหวยล่าสุดจาก result.json"""
    try:
        if not Path(RESULT_FILE).exists():
            return None
        data = json.loads(Path(RESULT_FILE).read_text(encoding="utf-8"))
        if isinstance(data, list) and len(data) > 0:
            return data[0]  # ผลล่าสุด
        elif isinstance(data, dict):
            return data
        return None
    except Exception as e:
        log.error(f"❌ Read result error: {e}")
        return None


def format_result(result):
    """จัดรูปแบบข้อความผลหวย"""
    if not result:
        return "ยังไม่มีผลหวยล่าสุด"

    lines = []
    flag = result.get("flag", "🎯")
    name = result.get("name", "หวย")
    date = result.get("date", "")
    top = result.get("top_number", "")
    bottom = result.get("bottom_number", "")

    lines.append(f"{flag}{flag} {name} {flag}{flag}")
    if date:
        lines.append(f"งวดวันที่ {date}")
    if top:
        digits = " ".join(top)
        lines.append(f"⬆️ บน : {digits}")
    if bottom:
        digits = " ".join(bottom)
        lines.append(f"⬇️ ล่าง : {digits}")

    return "\n".join(lines)


# ─── Reply Message ───────────────────────────────────

def reply_message(reply_token, text):
    """ส่ง Reply กลับ LINE — ฟรี 100%!"""
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CHANNEL_ACCESS_TOKEN}",
        }
        body = {
            "replyToken": reply_token,
            "messages": [{"type": "text", "text": text}],
        }
        res = requests.post(LINE_API, headers=headers, json=body, timeout=10)

        if res.ok:
            stats["replies"] += 1
            log.info(f"✅ [{stats['replies']}] Replied: {text[:50]}...")
            return True
        else:
            log.error(f"❌ Reply failed: {res.status_code} {res.text}")
            return False
    except Exception as e:
        log.error(f"❌ Reply error: {e}")
        return False


# ─── Webhook Handler ─────────────────────────────────

@app.route("/webhook", methods=["POST"])
def webhook():
    """LINE OA Webhook — รับข้อความ + Reply"""
    # Verify signature
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)

    if not verify_signature(body, signature):
        log.warning("⚠️ Invalid signature")
        abort(403)

    data = json.loads(body)

    for event in data.get("events", []):
        event_type = event.get("type")

        if event_type == "message":
            msg = event.get("message", {})
            msg_type = msg.get("type")
            text = msg.get("text", "")
            reply_token = event.get("replyToken", "")
            source = event.get("source", {})
            group_id = source.get("groupId", "")
            user_id = source.get("userId", "")

            log.info(f"📩 [{msg_type}] from {group_id or user_id}: {text}")

            # Trigger detected!
            if text.strip() == TRIGGER_CHAR:
                stats["triggers_received"] += 1
                log.info(f"🎯 Trigger #{stats['triggers_received']}! Replying with result...")

                result = get_latest_result()
                formatted = format_result(result)
                reply_message(reply_token, formatted)

        elif event_type == "join":
            # Bot ถูกเชิญเข้ากลุ่ม
            reply_token = event.get("replyToken", "")
            reply_message(reply_token, "🤖 LottoBot พร้อมส่งผลหวยครับ!")

    return "OK", 200


@app.route("/health")
def health():
    return jsonify({"ok": True, **stats})


@app.route("/test-reply", methods=["POST"])
def test_reply():
    """ทดสอบ format ข้อความ (ไม่ส่งจริง)"""
    result = get_latest_result()
    formatted = format_result(result)
    return jsonify({"formatted": formatted, "raw": result})


# ─── Main ────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("RESPONDER_PORT", "8082"))
    log.info(f"🚀 LINE OA Responder on port {port}")
    app.run(host="0.0.0.0", port=port)
