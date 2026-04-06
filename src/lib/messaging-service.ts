export async function checkLineQuota() {
  const cfg = await getProviderConfig()

  // ต้องเช็ค quota ของ official LINE ทุกครั้งที่เส้นทางส่ง "มีโอกาส" ไป official ได้
  // 1) primary เป็น official_line
  // 2) primary เป็น unofficial_line แต่เปิด autoFailover และ fallback เป็น official_line
  const canRouteToOfficialLine =
    cfg.primary === 'official_line' ||
    (cfg.primary === 'unofficial_line' &&
      cfg.autoFailover &&
      cfg.fallback === 'official_line')

  // ข้าม quota gate ได้เฉพาะกรณีที่ official LINE ไม่อยู่ในเส้นทางส่งจริง ๆ
  if (!canRouteToOfficialLine) {
    return {
      canSend: true,
      used: 0,
      quota: 0,
      remaining: 0,
      dailyBudget: 9999,
      todaySent: 0,
      daysLeft: 1,
      source: 'flag' as const,
      reason: 'official LINE is not in active send path (skip official LINE quota gate)',
    }
  }

  return checkOfficialLineQuota()
}
