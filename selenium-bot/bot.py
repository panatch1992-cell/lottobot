"""
LottoBot — LINE Web Selenium Bot
ส่งข้อความเข้ากลุ่ม LINE ผ่าน Chrome + Selenium
ไม่มี quota จำกัด ไม่ใช้ unofficial API
"""

import os
import json
import time
import logging
from pathlib import Path
from flask import Flask, request, jsonify
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ─── Config ──────────────────────────────────────────
LINE_WEB_URL = "https://chat.line.biz"
CHROME_PROFILE_DIR = os.environ.get("CHROME_PROFILE", "/app/chrome-profile")
HEADLESS = os.environ.get("HEADLESS", "true").lower() == "true"
PORT = int(os.environ.get("PORT", "8080"))
SCREENSHOT_DIR = "/app/screenshots"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("lottobot")

app = Flask(__name__)
driver = None

# ─── Chrome Setup ────────────────────────────────────

def create_driver():
    """สร้าง Chrome driver พร้อม profile ที่เก็บ session"""
    opts = Options()
    if HEADLESS:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    opts.add_argument(f"--user-data-dir={CHROME_PROFILE_DIR}")
    opts.add_argument("--lang=th-TH")
    # ป้องกัน bot detection
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    d = webdriver.Chrome(options=opts)
    d.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    return d


def init_driver():
    """เริ่ม Chrome + เปิด LINE Web"""
    global driver
    log.info("🚀 Starting Chrome...")
    driver = create_driver()
    driver.get("https://chat.line.biz/")
    time.sleep(3)
    log.info(f"📄 Page: {driver.title}")
    return driver


def take_screenshot(name="screenshot"):
    """ถ่าย screenshot เก็บไว้"""
    Path(SCREENSHOT_DIR).mkdir(parents=True, exist_ok=True)
    path = f"{SCREENSHOT_DIR}/{name}_{int(time.time())}.png"
    driver.save_screenshot(path)
    log.info(f"📸 Screenshot: {path}")
    return path


def is_logged_in():
    """เช็คว่า login LINE Web แล้วหรือยัง"""
    try:
        # LINE Web แสดงรายการแชทหลัง login
        driver.find_element(By.CSS_SELECTOR, "[data-testid='chat-list'], .chatlist, .MdTxt")
        return True
    except:
        return False


def get_qr_screenshot():
    """ถ่าย screenshot QR code สำหรับ login"""
    try:
        # รอ QR code แสดง
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "canvas, img[alt*='QR'], .qr-code"))
        )
        return take_screenshot("qr_login")
    except:
        return take_screenshot("login_page")


# ─── LINE Web Actions ────────────────────────────────

def send_message_to_group(group_name, text):
    """ส่งข้อความเข้ากลุ่ม LINE"""
    try:
        # ค้นหากลุ่ม
        search = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='search'], input[placeholder*='ค้นหา'], .search-input"))
        )
        search.clear()
        search.send_keys(group_name)
        time.sleep(2)

        # คลิกเลือกกลุ่ม
        group = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, f"//span[contains(text(), '{group_name}')]"))
        )
        group.click()
        time.sleep(1)

        # พิมพ์ข้อความ
        msg_box = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "[contenteditable='true'], textarea, .input-message"))
        )
        msg_box.click()
        msg_box.send_keys(text)
        time.sleep(0.5)

        # กด Enter ส่ง
        msg_box.send_keys(Keys.RETURN)
        time.sleep(1)

        log.info(f"✅ Sent to '{group_name}': {text[:50]}...")
        return {"success": True, "group": group_name}

    except Exception as e:
        log.error(f"❌ Failed to send to '{group_name}': {e}")
        take_screenshot("send_error")
        return {"success": False, "error": str(e)}


def send_message_by_id(chat_id, text):
    """ส่งข้อความด้วย chat URL ตรงๆ"""
    try:
        # เปิดแชทด้วย URL
        driver.get(f"https://chat.line.biz/message/{chat_id}")
        time.sleep(2)

        # พิมพ์ข้อความ
        msg_box = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "[contenteditable='true'], textarea"))
        )
        msg_box.click()
        msg_box.send_keys(text)
        time.sleep(0.5)
        msg_box.send_keys(Keys.RETURN)
        time.sleep(1)

        log.info(f"✅ Sent to chat {chat_id}: {text[:50]}...")
        return {"success": True}

    except Exception as e:
        log.error(f"❌ Failed: {e}")
        return {"success": False, "error": str(e)}


# ─── HTTP API ────────────────────────────────────────

@app.route("/health")
def health():
    logged_in = is_logged_in() if driver else False
    return jsonify({
        "ok": True,
        "logged_in": logged_in,
        "headless": HEADLESS,
    })


@app.route("/login-status")
def login_status():
    """ดูสถานะ login + QR screenshot"""
    if not driver:
        init_driver()
    logged_in = is_logged_in()
    if logged_in:
        return jsonify({"logged_in": True})
    else:
        qr_path = get_qr_screenshot()
        return jsonify({"logged_in": False, "qr_screenshot": qr_path})


@app.route("/screenshot")
def screenshot():
    """ถ่าย screenshot หน้าปัจจุบัน"""
    if not driver:
        return jsonify({"error": "Driver not started"})
    path = take_screenshot("current")
    return jsonify({"path": path})


@app.route("/send", methods=["POST"])
def send():
    """ส่งข้อความ"""
    data = request.json or {}
    group_name = data.get("group_name")
    chat_id = data.get("chat_id")
    text = data.get("text", "")

    if not text:
        return jsonify({"success": False, "error": "text required"})

    if not driver or not is_logged_in():
        return jsonify({"success": False, "error": "Not logged in — open /login-status"})

    if group_name:
        result = send_message_to_group(group_name, text)
    elif chat_id:
        result = send_message_by_id(chat_id, text)
    else:
        return jsonify({"success": False, "error": "group_name or chat_id required"})

    return jsonify(result)


@app.route("/send-all", methods=["POST"])
def send_all():
    """ส่งข้อความทุกกลุ่ม"""
    data = request.json or {}
    groups = data.get("groups", [])
    text = data.get("text", "")
    delay = data.get("delay", 2)

    if not text or not groups:
        return jsonify({"success": False, "error": "groups + text required"})

    results = []
    for group in groups:
        result = send_message_to_group(group, text)
        results.append(result)
        time.sleep(delay)  # delay ป้องกันแบน

    return jsonify({"success": True, "results": results})


# ─── Start ───────────────────────────────────────────

if __name__ == "__main__":
    init_driver()
    log.info(f"🚀 Server on port {PORT}")
    app.run(host="0.0.0.0", port=PORT)
