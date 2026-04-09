"""
trigger_bot.py — ตัวล่อ (Trigger)
ใช้ Playwright ควบคุม LINE Web/Chrome Extension
พิมพ์ "." เข้ากลุ่มเมื่อ Scraper เจอผลใหม่
→ LINE OA เห็น "." → Reply ผลหวยฟรี
"""

import os
import json
import time
import random
import asyncio
import logging
from pathlib import Path
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler("/app/trigger.log", encoding="utf-8")]
)
log = logging.getLogger("trigger")

# ─── Config ──────────────────────────────────────────
LINE_WEB_URL = "https://chat.line.biz/"
PROFILE_DIR = os.environ.get("BROWSER_PROFILE", "/app/browser-profile")
RESULT_FILE = os.environ.get("RESULT_FILE", "/app/data/result.json")
TRIGGER_CHAR = "."
CHECK_INTERVAL = int(os.environ.get("CHECK_INTERVAL", "30"))  # วินาที
GROUPS = json.loads(os.environ.get("GROUPS", '["บ้าน"]'))

stats = {"triggers": 0, "errors": 0, "last_trigger": None, "started_at": None}
last_result_hash = ""


# ─── Human-like Helpers ──────────────────────────────

async def human_delay(min_s=0.5, max_s=1.5):
    await asyncio.sleep(random.uniform(min_s, max_s))

async def human_type(page, selector, text):
    """พิมพ์ทีละตัว เหมือนคนพิมพ์"""
    element = page.locator(selector)
    for char in text:
        await element.type(char, delay=random.randint(30, 80))
    await human_delay(0.2, 0.5)


# ─── Playwright Browser ─────────────────────────────

async def create_browser():
    """สร้าง browser พร้อม persistent context (เก็บ session)"""
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()

    browser = await pw.chromium.launch_persistent_context(
        user_data_dir=PROFILE_DIR,
        headless=os.environ.get("HEADLESS", "true").lower() == "true",
        viewport={"width": 1280, "height": 900},
        locale="th-TH",
        timezone_id="Asia/Bangkok",
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
        ],
    )

    # ซ่อน automation flags
    page = browser.pages[0] if browser.pages else await browser.new_page()
    await page.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3]});
        window.chrome = { runtime: {} };
    """)

    return pw, browser, page


async def is_logged_in(page):
    """เช็คว่า login LINE Web แล้ว"""
    try:
        selectors = [
            "[data-testid='chat-list']",
            ".chatlist",
            "#wrap_chat_list",
            "[class*='chatList']",
        ]
        for sel in selectors:
            if await page.locator(sel).count() > 0:
                return True

        if "/message" in page.url or "/chat" in page.url:
            return True

        return False
    except:
        return False


async def wait_for_login(page):
    """รอ login — แสดง QR ให้สแกน"""
    await page.goto(LINE_WEB_URL)
    await human_delay(3, 5)

    if await is_logged_in(page):
        log.info("✅ Already logged in!")
        return True

    log.info("📱 รอสแกน QR Login...")
    log.info("📺 เปิด VNC: http://localhost:6080/vnc.html")
    await page.screenshot(path="/app/screenshots/qr_login.png")

    # รอ login สูงสุด 5 นาที
    for i in range(300):
        await asyncio.sleep(1)
        if await is_logged_in(page):
            log.info("✅ Login สำเร็จ!")
            return True
        if i % 30 == 0:
            log.info(f"⏳ รอ login... ({i}s)")

    log.error("❌ Login timeout (5 min)")
    return False


# ─── Send Trigger ────────────────────────────────────

async def send_trigger_to_group(page, group_name):
    """พิมพ์ "." เข้ากลุ่ม"""
    try:
        # กลับหน้าหลัก
        if "/message" not in page.url:
            await page.goto(LINE_WEB_URL)
            await human_delay(2, 3)

        # ค้นหากลุ่ม
        search_selectors = [
            "input[type='search']",
            "input[placeholder*='ค้นหา']",
            "input[placeholder*='Search']",
            ".search-input",
        ]

        search = None
        for sel in search_selectors:
            loc = page.locator(sel)
            if await loc.count() > 0:
                search = loc.first
                break

        if not search:
            log.warning("⚠️ Search box not found — reloading")
            await page.reload()
            await human_delay(2, 3)
            return False

        await search.clear()
        await human_delay(0.3, 0.5)
        await search.type(group_name, delay=random.randint(30, 80))
        await human_delay(1.5, 2.5)

        # คลิกกลุ่ม
        group = page.locator(f"text={group_name}").first
        if await group.count() == 0:
            log.warning(f"⚠️ Group '{group_name}' not found")
            return False

        await group.click()
        await human_delay(1, 2)

        # พิมพ์ trigger
        msg_selectors = [
            "[contenteditable='true']",
            "textarea",
            "#message-input",
        ]

        msg_box = None
        for sel in msg_selectors:
            loc = page.locator(sel)
            if await loc.count() > 0:
                msg_box = loc.first
                break

        if not msg_box:
            log.warning("⚠️ Message box not found")
            return False

        await msg_box.click()
        await human_delay(0.2, 0.4)
        await msg_box.type(TRIGGER_CHAR, delay=random.randint(30, 60))
        await human_delay(0.3, 0.5)
        await msg_box.press("Enter")
        await human_delay(0.5, 1)

        stats["triggers"] += 1
        stats["last_trigger"] = datetime.now().isoformat()
        log.info(f"✅ [{stats['triggers']}] Trigger sent to '{group_name}'")
        return True

    except Exception as e:
        stats["errors"] += 1
        log.error(f"❌ Trigger failed for '{group_name}': {e}")
        return False


# ─── Result Watcher ──────────────────────────────────

def get_result_hash():
    """อ่าน result file เช็คว่ามีอัพเดทไหม"""
    try:
        if not Path(RESULT_FILE).exists():
            return ""
        data = Path(RESULT_FILE).read_text()
        return str(hash(data))
    except:
        return ""


async def watch_and_trigger(page):
    """วนเช็ค result file ถ้ามีอัพเดท → trigger ทุกกลุ่ม"""
    global last_result_hash
    last_result_hash = get_result_hash()

    log.info(f"👀 Watching {RESULT_FILE} every {CHECK_INTERVAL}s")
    log.info(f"📋 Groups: {GROUPS}")

    while True:
        try:
            await asyncio.sleep(CHECK_INTERVAL)

            # เช็คว่ายัง login อยู่
            if not await is_logged_in(page):
                log.warning("⚠️ Session expired — reloading")
                await page.reload()
                await human_delay(3, 5)
                if not await is_logged_in(page):
                    log.error("❌ Cannot recover session — need re-login")
                    continue

            # เช็ค result update
            current_hash = get_result_hash()
            if current_hash != last_result_hash and current_hash != "":
                log.info("🆕 New result detected! Triggering...")
                last_result_hash = current_hash

                for group in GROUPS:
                    await send_trigger_to_group(page, group)
                    await human_delay(1.5, 3)  # delay ระหว่างกลุ่ม

        except Exception as e:
            stats["errors"] += 1
            log.error(f"❌ Watch error: {e}")
            await asyncio.sleep(10)


# ─── HTTP API (สำหรับ manual trigger) ────────────────

async def start_api(page):
    """HTTP endpoint ให้ Vercel/cron เรียก trigger ได้"""
    from aiohttp import web

    async def health(request):
        return web.json_response({
            "ok": True,
            "logged_in": await is_logged_in(page),
            **stats,
        })

    async def manual_trigger(request):
        data = await request.json()
        groups = data.get("groups", GROUPS)
        results = []
        for group in groups:
            ok = await send_trigger_to_group(page, group)
            results.append({"group": group, "triggered": ok})
            await human_delay(1.5, 3)
        return web.json_response({"success": True, "results": results})

    async def screenshot(request):
        path = f"/app/screenshots/api_{int(time.time())}.png"
        await page.screenshot(path=path)
        return web.json_response({"path": path})

    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_post("/trigger", manual_trigger)
    app.router.add_get("/screenshot", screenshot)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8081)
    await site.start()
    log.info("🌐 Trigger API on port 8081")


# ─── Main ────────────────────────────────────────────

async def main():
    stats["started_at"] = datetime.now().isoformat()
    Path("/app/screenshots").mkdir(parents=True, exist_ok=True)
    Path("/app/data").mkdir(parents=True, exist_ok=True)

    log.info("🚀 Starting Trigger Bot...")

    pw, browser, page = await create_browser()

    if not await wait_for_login(page):
        log.error("❌ Cannot login — exiting")
        return

    # เริ่ม API + watcher พร้อมกัน
    await asyncio.gather(
        start_api(page),
        watch_and_trigger(page),
    )


if __name__ == "__main__":
    asyncio.run(main())
