"""
LottoBot — LINE Web Selenium Bot (Hardened Edition)
ส่งข้อความเข้ากลุ่ม LINE ผ่าน Chrome + Selenium
ทนที่สุด: auto-restart, session persistence, human-like delay, element fail detection
"""

import os
import json
import time
import random
import logging
import signal
import sys
import traceback
from pathlib import Path
from datetime import datetime
from threading import Thread, Lock
from flask import Flask, request, jsonify
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    NoSuchElementException, TimeoutException, StaleElementReferenceException,
    WebDriverException, SessionNotCreatedException
)

# ─── Config ──────────────────────────────────────────
CHROME_PROFILE_DIR = os.environ.get("CHROME_PROFILE", "/app/chrome-profile")
PORT = int(os.environ.get("PORT", "8080"))
SCREENSHOT_DIR = "/app/screenshots"
MAX_RETRIES = 3
HEALTH_CHECK_INTERVAL = 300  # เช็คทุก 5 นาที
SESSION_FILE = f"{CHROME_PROFILE_DIR}/session_status.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("/app/bot.log", encoding="utf-8"),
    ]
)
log = logging.getLogger("lottobot")

app = Flask(__name__)
driver = None
driver_lock = Lock()
stats = {
    "started_at": None,
    "messages_sent": 0,
    "errors": 0,
    "restarts": 0,
    "last_send": None,
    "last_error": None,
    "logged_in": False,
}

# ─── Human-like Delays ───────────────────────────────

def human_delay(min_s=0.5, max_s=1.5):
    """สุ่ม delay เหมือนคนใช้งาน"""
    time.sleep(random.uniform(min_s, max_s))

def human_type(element, text):
    """พิมพ์ทีละตัว เหมือนคนพิมพ์"""
    for char in text:
        element.send_keys(char)
        time.sleep(random.uniform(0.02, 0.08))

def human_scroll(driver):
    """Scroll เล็กน้อย เหมือนคนเลื่อนหน้าจอ"""
    driver.execute_script(f"window.scrollBy(0, {random.randint(50, 150)})")
    human_delay(0.3, 0.7)

# ─── Chrome Setup (Hardened) ─────────────────────────

def create_driver():
    """สร้าง Chrome driver ที่ทนที่สุด"""
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    opts.add_argument(f"--user-data-dir={CHROME_PROFILE_DIR}")
    opts.add_argument("--lang=th-TH")

    # ─── Anti-detection ──────────────────────────────
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

    # ─── Performance ─────────────────────────────────
    opts.add_argument("--disable-extensions")
    opts.add_argument("--disable-infobars")
    opts.add_argument("--disable-notifications")
    opts.add_argument("--disable-popup-blocking")
    prefs = {
        "profile.default_content_setting_values.notifications": 2,
        "profile.default_content_setting_values.images": 2,  # บล็อกรูปภาพ ประหยัด bandwidth
    }
    opts.add_experimental_option("prefs", prefs)

    # ─── Crash recovery ──────────────────────────────
    opts.add_argument("--disable-crash-reporter")
    opts.add_argument("--disable-breakpad")

    d = webdriver.Chrome(options=opts)

    # ซ่อน webdriver flag
    d.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    d.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": """
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3]});
            Object.defineProperty(navigator, 'languages', {get: () => ['th-TH', 'th', 'en']});
            window.chrome = { runtime: {} };
        """
    })

    d.set_page_load_timeout(30)
    d.implicitly_wait(5)

    return d


# ─── Driver Management (Auto-restart) ────────────────

def init_driver():
    """เริ่ม Chrome + เปิด LINE Web พร้อม auto-recovery"""
    global driver
    with driver_lock:
        try:
            if driver:
                try:
                    driver.quit()
                except:
                    pass

            log.info("🚀 Starting Chrome...")
            driver = create_driver()
            driver.get("https://chat.line.biz/")
            human_delay(3, 5)
            log.info(f"📄 Page: {driver.title}")

            stats["logged_in"] = is_logged_in()
            if stats["logged_in"]:
                log.info("✅ Already logged in!")
                save_session_status(True)
            else:
                log.warning("⚠️ Not logged in — need QR scan via VNC")
                save_session_status(False)

            return True
        except Exception as e:
            log.error(f"❌ Failed to start Chrome: {e}")
            stats["last_error"] = str(e)
            return False


def restart_driver():
    """Restart Chrome อัตโนมัติ"""
    log.warning("🔄 Restarting Chrome...")
    stats["restarts"] += 1
    return init_driver()


def ensure_driver():
    """ตรวจสอบว่า driver ยังทำงาน — ถ้าไม่ restart"""
    global driver
    try:
        if driver is None:
            return restart_driver()
        # ทดสอบว่า driver ยัง alive
        _ = driver.title
        return True
    except:
        log.warning("⚠️ Driver dead — restarting")
        return restart_driver()


def safe_find(by, value, timeout=10, retries=2):
    """หา element พร้อม retry + reload ถ้าไม่เจอ"""
    for attempt in range(retries):
        try:
            element = WebDriverWait(driver, timeout).until(
                EC.presence_of_element_located((by, value))
            )
            return element
        except (TimeoutException, NoSuchElementException, StaleElementReferenceException):
            if attempt < retries - 1:
                log.warning(f"⚠️ Element not found: {value} — reloading (attempt {attempt + 1})")
                driver.refresh()
                human_delay(2, 4)
            else:
                raise


def safe_click(by, value, timeout=10):
    """คลิก element พร้อม retry"""
    for attempt in range(3):
        try:
            element = WebDriverWait(driver, timeout).until(
                EC.element_to_be_clickable((by, value))
            )
            human_delay(0.2, 0.5)
            element.click()
            return True
        except (StaleElementReferenceException, WebDriverException):
            human_delay(0.5, 1)
    return False


# ─── Session Management ──────────────────────────────

def save_session_status(logged_in):
    """บันทึกสถานะ session"""
    Path(CHROME_PROFILE_DIR).mkdir(parents=True, exist_ok=True)
    data = {
        "logged_in": logged_in,
        "timestamp": datetime.now().isoformat(),
        "restarts": stats["restarts"],
    }
    with open(SESSION_FILE, "w") as f:
        json.dump(data, f)


def is_logged_in():
    """เช็คว่า login LINE Web แล้ว"""
    try:
        selectors = [
            "[data-testid='chat-list']",
            ".chatlist",
            ".MdTxt",
            "#wrap_chat_list",
            "[class*='chatList']",
            "[class*='ChatList']",
        ]
        for sel in selectors:
            try:
                driver.find_element(By.CSS_SELECTOR, sel)
                return True
            except NoSuchElementException:
                continue

        # เช็คจาก URL — ถ้าอยู่หน้า chat = login แล้ว
        if "/message" in driver.current_url or "/chat" in driver.current_url:
            return True

        return False
    except:
        return False


def take_screenshot(name="screenshot"):
    """ถ่าย screenshot"""
    try:
        Path(SCREENSHOT_DIR).mkdir(parents=True, exist_ok=True)
        path = f"{SCREENSHOT_DIR}/{name}_{int(time.time())}.png"
        driver.save_screenshot(path)
        log.info(f"📸 {path}")
        return path
    except:
        return None


# ─── LINE Web Actions (Hardened) ─────────────────────

def send_message_to_group(group_name, text):
    """ส่งข้อความเข้ากลุ่ม — พร้อม retry + recovery"""
    if not ensure_driver():
        return {"success": False, "error": "Chrome not running"}

    if not is_logged_in():
        return {"success": False, "error": "Not logged in"}

    for attempt in range(MAX_RETRIES):
        try:
            # กลับหน้าหลัก
            if "/message" not in driver.current_url:
                driver.get("https://chat.line.biz/")
                human_delay(2, 3)

            # ค้นหากลุ่ม
            search_selectors = [
                "input[type='search']",
                "input[placeholder*='ค้นหา']",
                "input[placeholder*='Search']",
                ".search-input",
                "[data-testid='search-input']",
            ]

            search = None
            for sel in search_selectors:
                try:
                    search = WebDriverWait(driver, 5).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, sel))
                    )
                    break
                except:
                    continue

            if not search:
                log.warning("⚠️ Search box not found — reloading")
                driver.refresh()
                human_delay(2, 3)
                continue

            search.clear()
            human_delay(0.3, 0.6)
            human_type(search, group_name)
            human_delay(1.5, 2.5)

            # คลิกกลุ่ม
            group_clicked = False
            group_selectors = [
                f"//span[contains(text(), '{group_name}')]",
                f"//div[contains(text(), '{group_name}')]",
                f"//p[contains(text(), '{group_name}')]",
            ]
            for xpath in group_selectors:
                try:
                    group = WebDriverWait(driver, 5).until(
                        EC.element_to_be_clickable((By.XPATH, xpath))
                    )
                    human_delay(0.3, 0.6)
                    group.click()
                    group_clicked = True
                    break
                except:
                    continue

            if not group_clicked:
                log.warning(f"⚠️ Group '{group_name}' not found (attempt {attempt + 1})")
                driver.refresh()
                human_delay(2, 3)
                continue

            human_delay(1, 2)

            # พิมพ์ข้อความ
            msg_selectors = [
                "[contenteditable='true']",
                "textarea",
                ".input-message",
                "[data-testid='message-input']",
                "#message-input",
            ]

            msg_box = None
            for sel in msg_selectors:
                try:
                    msg_box = WebDriverWait(driver, 5).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, sel))
                    )
                    break
                except:
                    continue

            if not msg_box:
                log.warning("⚠️ Message box not found — reloading")
                driver.refresh()
                human_delay(2, 3)
                continue

            msg_box.click()
            human_delay(0.2, 0.4)

            # พิมพ์ทีละบรรทัด (รองรับ multiline)
            lines = text.split('\n')
            for i, line in enumerate(lines):
                human_type(msg_box, line)
                if i < len(lines) - 1:
                    msg_box.send_keys(Keys.SHIFT + Keys.RETURN)
                    human_delay(0.1, 0.3)

            human_delay(0.5, 1)

            # กด Enter ส่ง
            msg_box.send_keys(Keys.RETURN)
            human_delay(1, 2)

            # บันทึกสถิติ
            stats["messages_sent"] += 1
            stats["last_send"] = datetime.now().isoformat()
            log.info(f"✅ [{stats['messages_sent']}] Sent to '{group_name}': {text[:50]}...")

            return {"success": True, "group": group_name, "attempt": attempt + 1}

        except Exception as e:
            log.error(f"❌ Attempt {attempt + 1} failed for '{group_name}': {e}")
            stats["errors"] += 1
            stats["last_error"] = f"{datetime.now().isoformat()}: {str(e)}"

            if attempt < MAX_RETRIES - 1:
                # ลอง reload + retry
                try:
                    driver.refresh()
                except:
                    restart_driver()
                human_delay(2, 4)

    take_screenshot(f"failed_{group_name}")
    return {"success": False, "error": f"Failed after {MAX_RETRIES} attempts", "group": group_name}


# ─── Background Health Monitor ───────────────────────

def health_monitor():
    """เช็คสถานะ + auto-restart ถ้ามีปัญหา"""
    while True:
        try:
            time.sleep(HEALTH_CHECK_INTERVAL)

            if not ensure_driver():
                log.error("❌ Health check failed — restarting")
                restart_driver()
                continue

            if not is_logged_in():
                log.warning("⚠️ Session expired — need re-login")
                stats["logged_in"] = False
                save_session_status(False)
                # ลอง reload อาจกลับมา
                driver.refresh()
                human_delay(3, 5)
                if is_logged_in():
                    log.info("✅ Session recovered after reload!")
                    stats["logged_in"] = True
                    save_session_status(True)
            else:
                stats["logged_in"] = True

            log.info(f"💓 Health OK — sent: {stats['messages_sent']}, errors: {stats['errors']}, restarts: {stats['restarts']}")

        except Exception as e:
            log.error(f"❌ Health monitor error: {e}")


# ─── HTTP API ────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({
        "ok": True,
        "logged_in": stats["logged_in"],
        "messages_sent": stats["messages_sent"],
        "errors": stats["errors"],
        "restarts": stats["restarts"],
        "started_at": stats["started_at"],
        "last_send": stats["last_send"],
        "last_error": stats["last_error"],
    })


@app.route("/screenshot")
def screenshot_api():
    if not ensure_driver():
        return jsonify({"error": "Driver not running"})
    path = take_screenshot("api_request")
    return jsonify({"path": path})


@app.route("/send", methods=["POST"])
def send():
    data = request.json or {}
    group_name = data.get("group_name") or data.get("to")
    text = data.get("text", "")

    if not text:
        return jsonify({"success": False, "error": "text required"})
    if not group_name:
        return jsonify({"success": False, "error": "group_name required"})

    with driver_lock:
        result = send_message_to_group(group_name, text)

    return jsonify(result)


@app.route("/send-all", methods=["POST"])
def send_all():
    data = request.json or {}
    groups = data.get("groups", [])
    text = data.get("text", "")
    delay_min = data.get("delay_min", 1.5)
    delay_max = data.get("delay_max", 3.0)

    if not text or not groups:
        return jsonify({"success": False, "error": "groups + text required"})

    results = []
    with driver_lock:
        for group in groups:
            result = send_message_to_group(group, text)
            results.append(result)
            # Human-like delay ระหว่างกลุ่ม
            human_delay(delay_min, delay_max)

    sent = sum(1 for r in results if r.get("success"))
    return jsonify({
        "success": sent > 0,
        "sent": sent,
        "total": len(groups),
        "results": results,
    })


@app.route("/restart", methods=["POST"])
def restart_api():
    """Manual restart Chrome"""
    ok = restart_driver()
    return jsonify({"success": ok, "restarts": stats["restarts"]})


# ─── Graceful Shutdown ───────────────────────────────

def shutdown(signum, frame):
    log.info("🛑 Shutting down...")
    if driver:
        try:
            driver.quit()
        except:
            pass
    sys.exit(0)

signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)


# ─── Start ───────────────────────────────────────────

if __name__ == "__main__":
    stats["started_at"] = datetime.now().isoformat()

    # เริ่ม Chrome
    if not init_driver():
        log.error("❌ Failed to start — retrying in 10s")
        time.sleep(10)
        init_driver()

    # เริ่ม health monitor background
    monitor = Thread(target=health_monitor, daemon=True)
    monitor.start()

    log.info(f"🚀 LottoBot Selenium on port {PORT}")
    app.run(host="0.0.0.0", port=PORT, threaded=True)
