"""
Minimal Unofficial LINE Client
ใช้ LINE's internal API โดยตรง ไม่พึ่ง linepy

Features:
- Login ด้วย email/password
- ดึง group list
- ส่งข้อความเข้ากลุ่ม
"""

import requests
import json
import time
import hmac
import hashlib
import base64
import sys
from urllib.parse import urlencode

# LINE Internal API endpoints
LINE_API = "https://gd2.line.naver.jp"
LINE_AUTH = "https://access.line.me"
LINE_LEGY = "https://legy-jp-addr.line.naver.jp"

HEADERS_BASE = {
    "User-Agent": "Line/12.0.0 iPad8,6 16.0",
    "X-Line-Application": "IOSIPAD\t12.0.0\tiOS\t16.0",
    "X-Line-Carrier": "wifi",
    "Content-Type": "application/json",
}


def login_with_email(email: str, password: str) -> dict:
    """Login ด้วย email + password → ได้ auth token"""

    print(f"⏳ กำลัง login ด้วย {email}...")

    # Step 1: Get RSA key
    rsa_url = f"{LINE_API}/api/v3/TalkService.do"
    headers = {**HEADERS_BASE}

    # Use LINE's v2 login endpoint
    login_url = f"{LINE_AUTH}/v2/oauth/accessToken"

    # Try direct token request
    login_data = {
        "grant_type": "password",
        "email": email,
        "password": password,
        "client_id": "12345678",  # LINE internal client ID
    }

    try:
        # Method 1: Direct login API
        resp = requests.post(
            f"{LINE_API}/api/v4p/rs",
            headers={
                **HEADERS_BASE,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data=urlencode({
                "type": "1",
                "identityProvider": "LINE",
                "identifier": email,
                "password": password,
                "keepLoggedIn": "true",
                "accessLocation": "127.0.0.1",
                "systemName": "LottoBot",
                "e2eeVersion": "0",
            }),
            timeout=30,
        )

        if resp.status_code == 200:
            data = resp.json()
            if "result" in data and "authToken" in data["result"]:
                return {"success": True, "token": data["result"]["authToken"]}

        # Method 2: Try primary token endpoint
        resp2 = requests.post(
            f"{LINE_API}/api/v4/TalkService.do",
            headers={
                **HEADERS_BASE,
                "Content-Type": "application/x-thrift-compact",
            },
            timeout=30,
        )

        return {
            "success": False,
            "error": f"Login failed: HTTP {resp.status_code} - {resp.text[:200]}",
            "hint": "LINE อาจต้อง verify ผ่าน app — เช็คมือถือ",
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


def get_groups(auth_token: str) -> list:
    """ดึง group list ที่บัญชีอยู่"""
    headers = {
        **HEADERS_BASE,
        "X-Line-Access": auth_token,
    }

    try:
        resp = requests.get(
            f"{LINE_API}/api/v4p/rs",
            headers=headers,
            params={"type": "getGroupIdsJoined"},
            timeout=15,
        )

        if resp.status_code == 200:
            return resp.json().get("memberMids", [])
    except Exception as e:
        print(f"❌ ดึงกลุ่มไม่ได้: {e}")

    return []


def send_text(auth_token: str, to: str, text: str) -> dict:
    """ส่งข้อความไปกลุ่ม"""
    headers = {
        **HEADERS_BASE,
        "X-Line-Access": auth_token,
    }

    try:
        resp = requests.post(
            f"{LINE_API}/api/v4p/rs",
            headers=headers,
            json={
                "to": to,
                "text": text,
                "contentType": 0,
                "type": "sendMessage",
            },
            timeout=15,
        )

        return {"success": resp.status_code == 200}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ═══ Main ═══

if __name__ == "__main__":
    print("=" * 50)
    print("🔧 LottoBot — ตั้งค่า Unofficial LINE Bot")
    print("=" * 50)
    print()

    email = input("📧 Email: ").strip()
    password = input("🔑 Password: ").strip()

    if not email or not password:
        print("❌ กรุณาใส่ email และ password")
        sys.exit(1)

    result = login_with_email(email, password)

    if result["success"]:
        token = result["token"]
        print()
        print("✅ Login สำเร็จ!")
        print()
        print("─" * 50)
        print("AUTH TOKEN:")
        print(token)
        print("─" * 50)

        groups = get_groups(token)
        if groups:
            print()
            print("👥 กลุ่ม:")
            for g in groups:
                print(f"  {g}")

        # Save
        with open("scripts/unofficial_config.json", "w") as f:
            json.dump({"token": token, "groups": groups}, f, indent=2)
        print()
        print("💾 บันทึกที่ scripts/unofficial_config.json")
    else:
        print()
        print(f"❌ {result['error']}")
        if "hint" in result:
            print(f"💡 {result['hint']}")
        print()
        print("ทางเลือก:")
        print("1. เช็ค email/password ว่าถูกต้อง")
        print("2. เปิด LINE app บนมือถือ verify ก่อน")
        print("3. ลองใหม่อีกครั้ง")
