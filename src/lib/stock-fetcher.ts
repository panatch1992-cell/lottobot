// Stock Index Fetcher — ดึงราคาดัชนีหุ้นจาก Yahoo Finance
// แล้วคำนวณเลขหวยหุ้น 3 ตัวบน + 2 ตัวล่าง
//
// สูตร:
//   บน (3 ตัว) = 3 หลักสุดท้ายของส่วนจำนวนเต็ม
//   ล่าง (2 ตัว) = 2 หลักแรกของทศนิยม
//   เช่น Nikkei = 38,456.73 → บน = 456, ล่าง = 73

import axios from 'axios'

interface StockResult {
  success: boolean
  top_number?: string
  bottom_number?: string
  close_price?: number
  symbol?: string
  error?: string
}

// Mapping ชื่อหวย → Yahoo Finance symbol
// ใช้ pattern matching กับชื่อหวยจาก DB
const STOCK_LOTTERY_MAP: Record<string, { symbol: string; name: string }> = {
  // Nikkei (ญี่ปุ่น)
  'นิเคอิเช้า VIP': { symbol: '^N225', name: 'Nikkei 225' },
  'นิเคอิเช้า ปกติ': { symbol: '^N225', name: 'Nikkei 225' },
  'นิเคอิบ่ายปกติ': { symbol: '^N225', name: 'Nikkei 225' },
  // China (จีน)
  'จีนเช้า VIP': { symbol: '000001.SS', name: 'Shanghai Composite' },
  'จีนเช้าปกติ': { symbol: '000001.SS', name: 'Shanghai Composite' },
  'จีนบ่ายปกติ': { symbol: '000001.SS', name: 'Shanghai Composite' },
  'จีนบ่าย VIP': { symbol: '000001.SS', name: 'Shanghai Composite' },
  // Hang Seng (ฮ่องกง)
  'ฮั่งเส็งเช้าปกติ': { symbol: '^HSI', name: 'Hang Seng Index' },
  'ฮั่งเส็งบ่าย': { symbol: '^HSI', name: 'Hang Seng Index' },
  'ฮั่งเส็งบ่าย VIP': { symbol: '^HSI', name: 'Hang Seng Index' },
  // Taiwan (ไต้หวัน)
  'ไต้หวัน VIP': { symbol: '^TWII', name: 'TWSE' },
  'ไต้หวันปกติ': { symbol: '^TWII', name: 'TWSE' },
  // Korea (เกาหลี)
  'เกาหลี VIP': { symbol: '^KS11', name: 'KOSPI' },
  'เกาหลีปกติ': { symbol: '^KS11', name: 'KOSPI' },
  // Singapore
  'สิงคโปร์': { symbol: '^STI', name: 'STI' },
  // Thailand
  'หุ้นไทยเย็น': { symbol: '^SET.BK', name: 'SET Index' },
  // India
  'หุ้นอินเดีย': { symbol: '^BSESN', name: 'BSE Sensex' },
  // Russia
  'รัสเซีย': { symbol: 'IMOEX.ME', name: 'MOEX Russia' },
  // UK
  'อังกฤษ': { symbol: '^FTSE', name: 'FTSE 100' },
  // Germany
  'เยอรมัน': { symbol: '^GDAXI', name: 'DAX' },
  // Dow Jones (USA)
  'ดาวโจนส์ VIP': { symbol: '^DJI', name: 'Dow Jones' },
  'ดาวโจนส์ปกติ': { symbol: '^DJI', name: 'Dow Jones' },
  'ดาวโจนส์ Star': { symbol: '^DJI', name: 'Dow Jones' },
}

/**
 * ตรวจว่าหวยนี้เป็นหวยหุ้น (ดึงจาก stock index ได้) หรือไม่
 */
export function isStockLottery(lotteryName: string): boolean {
  return lotteryName in STOCK_LOTTERY_MAP
}

/**
 * ดึงข้อมูล stock symbol ของหวย
 */
export function getStockInfo(lotteryName: string) {
  return STOCK_LOTTERY_MAP[lotteryName] || null
}

/**
 * คำนวณเลขหวยจากราคาดัชนีหุ้น
 * บน (3 ตัว) = 3 หลักสุดท้ายของจำนวนเต็ม
 * ล่าง (2 ตัว) = 2 หลักแรกหลังจุดทศนิยม
 */
export function calculateLotteryNumbers(price: number): { top: string; bottom: string } {
  const intPart = Math.floor(price)
  const decPart = price - intPart

  // บน: 3 หลักสุดท้ายของจำนวนเต็ม
  const top = String(intPart % 1000).padStart(3, '0')

  // ล่าง: 2 หลักแรกหลังจุด (ปัดลง)
  const bottom = String(Math.floor(decPart * 100) % 100).padStart(2, '0')

  return { top, bottom }
}

/**
 * ดึงราคาดัชนีหุ้นจาก Yahoo Finance
 */
async function fetchYahooFinance(symbol: string): Promise<{ success: boolean; price?: number; error?: string }> {
  const encodedSymbol = encodeURIComponent(symbol)

  // ลอง Yahoo Finance v8 API (unofficial but widely used)
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=1d`,
  ]

  for (const url of urls) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        timeout: 10000,
      })

      const result = data?.chart?.result?.[0]
      if (!result) continue

      // Get the most recent price
      const meta = result.meta
      const price = meta?.regularMarketPrice || meta?.previousClose

      if (price && typeof price === 'number') {
        return { success: true, price }
      }
    } catch {
      continue
    }
  }

  // Fallback: ลองใช้ Yahoo Finance quote endpoint
  try {
    const { data } = await axios.get(
      `https://query1.finance.yahoo.com/v6/finance/quote?symbols=${encodedSymbol}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        timeout: 10000,
      }
    )

    const quote = data?.quoteResponse?.result?.[0]
    const price = quote?.regularMarketPrice || quote?.regularMarketPreviousClose

    if (price && typeof price === 'number') {
      return { success: true, price }
    }
  } catch {
    // continue to error
  }

  return { success: false, error: `Cannot fetch price for ${symbol}` }
}

/**
 * ดึงผลหวยหุ้นจาก stock index
 * ใช้กับหวยที่เป็น stock-based เท่านั้น
 */
export async function fetchStockLotteryResult(lotteryName: string): Promise<StockResult> {
  const stockInfo = STOCK_LOTTERY_MAP[lotteryName]
  if (!stockInfo) {
    return { success: false, error: `"${lotteryName}" is not a stock-based lottery` }
  }

  const priceResult = await fetchYahooFinance(stockInfo.symbol)
  if (!priceResult.success || !priceResult.price) {
    return { success: false, error: priceResult.error || 'Failed to fetch price' }
  }

  const { top, bottom } = calculateLotteryNumbers(priceResult.price)

  return {
    success: true,
    top_number: top,
    bottom_number: bottom,
    close_price: priceResult.price,
    symbol: stockInfo.symbol,
  }
}

/**
 * รายชื่อหวยหุ้นทั้งหมดที่ support
 */
export function listStockLotteries(): string[] {
  return Object.keys(STOCK_LOTTERY_MAP)
}

/**
 * รายชื่อหวยที่ไม่ใช่หุ้น (Hanoi, Laos) — ต้อง scrape หรือกรอกมือ
 */
export function isManualLottery(lotteryName: string): boolean {
  const manualPatterns = ['ฮานอย', 'ลาว']
  return manualPatterns.some(p => lotteryName.includes(p))
}
