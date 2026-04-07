"""
LottoBot — ดึง Token + Group ID จากบัญชี LINE Unofficial

วิธีใช้:
1. pip install linepy
2. python scripts/setup_unofficial.py

จะถาม email + password → login → แสดง:
- Auth Token (ใส่ใน Render env: LINE_AUTH_TOKEN)
- Group ID ทุกกลุ่มที่บัญชีนี้อยู่ (ใส่ใน DB: unofficial_group_id)
"""

import sys
import json

def main():
    try:
        from linepy import LINE
    except ImportError:
        print("❌ ยังไม่ได้ติดตั้ง linepy")
        print("   รัน: pip install linepy")
        sys.exit(1)

    print("=" * 50)
    print("🔧 LottoBot — ตั้งค่า Unofficial LINE Bot")
    print("=" * 50)
    print()

    email = input("📧 Email ที่ลูกค้ากรอก: ").strip()
    password = input("🔑 Password: ").strip()

    if not email or not password:
        print("❌ กรุณาใส่ email และ password")
        sys.exit(1)

    print()
    print("⏳ กำลัง login...")

    try:
        client = LINE()
        client.login(email=email, password=password)
    except Exception as e:
        print(f"❌ Login ไม่สำเร็จ: {e}")
        print()
        print("สาเหตุที่เป็นไปได้:")
        print("  - Email/Password ไม่ถูกต้อง")
        print("  - ต้อง verify ผ่าน LINE app ก่อน (เช็คมือถือ)")
        print("  - บัญชีถูกล็อค")
        sys.exit(1)

    # ดึง Auth Token
    auth_token = client.authToken
    print()
    print("✅ Login สำเร็จ!")
    print()
    print("─" * 50)
    print("📋 AUTH TOKEN (ใส่ใน Render env → LINE_AUTH_TOKEN):")
    print("─" * 50)
    print(auth_token)
    print()

    # ดึง Group IDs
    print("─" * 50)
    print("👥 กลุ่ม LINE ที่บัญชีนี้อยู่:")
    print("─" * 50)

    try:
        group_ids = client.getGroupIdsJoined()
        groups = []
        for gid in group_ids:
            try:
                group = client.getGroup(gid)
                groups.append({
                    "id": gid,
                    "name": group.name,
                    "member_count": len(group.members) if group.members else 0,
                })
                print(f"  {group.name}")
                print(f"    ID: {gid}")
                print(f"    สมาชิก: {len(group.members) if group.members else '?'} คน")
                print()
            except Exception:
                groups.append({"id": gid, "name": "unknown", "member_count": 0})
                print(f"  (ดึงข้อมูลกลุ่มไม่ได้) ID: {gid}")
                print()
    except Exception as e:
        print(f"❌ ดึงกลุ่มไม่ได้: {e}")
        groups = []

    if not groups:
        print("⚠️ ยังไม่มีกลุ่ม — ให้ลูกค้าเชิญบัญชีนี้เข้ากลุ่ม LINE ก่อน")
        print("   แล้วรัน script นี้อีกครั้ง")

    # สรุป
    print()
    print("=" * 50)
    print("📋 สรุปสิ่งที่ต้องทำ:")
    print("=" * 50)
    print()
    print("1. Render → Environment Variables:")
    print(f"   LINE_AUTH_TOKEN = {auth_token[:20]}...")
    print()
    print("2. Supabase → line_groups → unofficial_group_id:")
    for g in groups:
        print(f"   {g['name']} → {g['id']}")
    print()
    print("3. ตรวจสอบ: เข้า /settings → กด 'ตรวจสอบระบบทั้งหมด'")
    print()

    # Save to file
    output = {
        "auth_token": auth_token,
        "groups": groups,
    }
    with open("scripts/unofficial_config.json", "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print("💾 บันทึกไว้ที่ scripts/unofficial_config.json")
    print()
    print("⚠️ อย่า commit ไฟล์นี้เข้า git! (มี token)")

if __name__ == "__main__":
    main()
