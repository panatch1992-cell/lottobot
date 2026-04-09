/**
 * PIN Login — ล็อกอิน LINE ด้วย email/password + PIN
 * ใช้ @evex/linejs สำหรับ Deno
 *
 * Usage: deno run -A scripts/pin-login.ts
 */

import { Client } from "jsr:@evex/linejs";

const email = prompt("Email:") || "";
const password = prompt("Password:") || "";

if (!email || !password) {
  console.log("❌ กรุณาใส่ email และ password");
  Deno.exit(1);
}

const client = new Client();

client.on("pincall", (pin: string) => {
  console.log("\n─────────────────────");
  console.log(`  PIN: ${pin}`);
  console.log("  คลิก verify on มือ LINE app");
  console.log("─────────────────────\n");
});

try {
  await client.login({
    email,
    password,
    device: "DESKTOPWIN",
  });

  console.log("\n✅ Login สำเร็จ!");
  console.log("\n─────────────────────");
  console.log("AUTH TOKEN:");
  console.log(client.authToken);
  console.log("─────────────────────\n");

  // ดึงกลุ่ม
  try {
    const groups = await client.getGroupIdsJoined();
    if (groups && groups.length > 0) {
      console.log(`👥 กลุ่ม (${groups.length}):`);
      for (const gid of groups) {
        try {
          const g = await client.getGroup(gid);
          console.log(`  ${g.name || "?"} → ${gid}`);
        } catch {
          console.log(`  ? → ${gid}`);
        }
      }
    } else {
      console.log("⚠️ ไม่มีกลุ่ม");
    }
  } catch (e) {
    console.log("⚠️ ดึงกลุ่มไม่ได้:", e.message);
  }
} catch (e) {
  console.log("❌ Login ไม่สำเร็จ:", e.message);
  Deno.exit(1);
}
