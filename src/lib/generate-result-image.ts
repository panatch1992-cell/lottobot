// LottoBot — Generate lottery result image JSX for ImageResponse (next/og)
// Uses Satori under the hood — works on Vercel Edge Runtime with zero dependencies

import React from 'react'

export interface ResultImageData {
  lottery_name: string
  flag: string
  date: string
  top_number?: string
  bottom_number?: string
  full_number?: string
}

const BUBBLE_COLORS = [
  '#FF6B8A', // pink
  '#FF9F43', // orange
  '#FFDD59', // yellow
  '#5CE0D2', // teal
  '#74B9FF', // blue
  '#A29BFE', // purple
]

function getColor(index: number): string {
  return BUBBLE_COLORS[index % BUBBLE_COLORS.length]
}

function DigitBubble({ digit, index }: { digit: string; index: number }) {
  const bg = getColor(index)
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 90,
        height: 90,
        borderRadius: '50%',
        backgroundColor: bg,
        color: '#fff',
        fontSize: 52,
        fontWeight: 800,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        margin: '0 6px',
      },
    },
    digit
  )
}

function NumberRow({
  label,
  number,
  colorOffset,
}: {
  label: string
  number: string
  colorOffset: number
}) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginBottom: 12,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          fontSize: 24,
          color: '#666',
          marginBottom: 10,
        },
      },
      label
    ),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      ...number.split('').map((digit, i) =>
        React.createElement(DigitBubble, {
          key: i,
          digit,
          index: i + colorOffset,
        })
      )
    )
  )
}

export function buildResultImageJSX(data: ResultImageData) {
  const children: React.ReactNode[] = []

  // Header: flag + lottery name
  children.push(
    React.createElement(
      'div',
      {
        key: 'header',
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 42,
          fontWeight: 700,
          color: '#333',
          marginBottom: 4,
        },
      },
      `${data.flag} ${data.lottery_name} ${data.flag}`
    )
  )

  // Date
  children.push(
    React.createElement(
      'div',
      {
        key: 'date',
        style: {
          display: 'flex',
          fontSize: 22,
          color: '#888',
          marginBottom: 24,
        },
      },
      `งวดวันที่ ${data.date}`
    )
  )

  // Separator
  children.push(
    React.createElement('div', {
      key: 'sep1',
      style: {
        width: 500,
        height: 2,
        backgroundColor: '#e0e0e0',
        marginBottom: 24,
        borderRadius: 1,
      },
    })
  )

  // Top number
  if (data.top_number) {
    children.push(
      React.createElement(NumberRow, {
        key: 'top',
        label: '⬆️ เลขบน',
        number: data.top_number,
        colorOffset: 0,
      })
    )
  }

  // Bottom number
  if (data.bottom_number) {
    children.push(
      React.createElement(NumberRow, {
        key: 'bottom',
        label: '⬇️ เลขล่าง',
        number: data.bottom_number,
        colorOffset: 3,
      })
    )
  }

  // Full number
  if (data.full_number) {
    children.push(
      React.createElement(NumberRow, {
        key: 'full',
        label: '🔢 เลขเต็ม',
        number: data.full_number,
        colorOffset: 0,
      })
    )
  }

  // Footer
  children.push(
    React.createElement(
      'div',
      {
        key: 'footer',
        style: {
          display: 'flex',
          fontSize: 14,
          color: '#bbb',
          marginTop: 'auto',
          paddingTop: 16,
        },
      },
      'LottoBot — ระบบส่งผลหวยอัตโนมัติ'
    )
  )

  // Main container with gradient background
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #fdfcfb 0%, #e2d1c3 100%)',
        padding: 40,
        fontFamily: 'sans-serif',
      },
    },
    ...children
  )
}
