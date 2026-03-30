// LottoBot — Generate lottery result image JSX for ImageResponse (next/og)
// Style: Macaroon pastel color digits (inspired by LINE Emoji sticker packs)

import React from 'react'

export interface ResultImageData {
  lottery_name: string
  flag: string
  date: string
  top_number?: string
  bottom_number?: string
  full_number?: string
}

// Macaroon pastel color palette — soft, cute, like LINE Emoji stickers
const MACAROON_COLORS = [
  { bg: '#FFD1DC', text: '#D4526E', border: '#F8A5B8' }, // pink
  { bg: '#FFE5B4', text: '#CC8400', border: '#FFD080' }, // peach/orange
  { bg: '#FFFACD', text: '#B8960C', border: '#FFE44D' }, // lemon yellow
  { bg: '#C1F0C1', text: '#2D8B2D', border: '#8ED88E' }, // mint green
  { bg: '#B8E0FF', text: '#2E6DA4', border: '#80C4FF' }, // sky blue
  { bg: '#E0C8FF', text: '#7B4DBF', border: '#C89EFF' }, // lavender
  { bg: '#FFD1DC', text: '#D4526E', border: '#F8A5B8' }, // pink (repeat for >6)
  { bg: '#FFE5B4', text: '#CC8400', border: '#FFD080' }, // peach (repeat)
  { bg: '#FFFACD', text: '#B8960C', border: '#FFE44D' }, // yellow (repeat)
  { bg: '#C1F0C1', text: '#2D8B2D', border: '#8ED88E' }, // green (repeat)
]

function getColor(index: number) {
  return MACAROON_COLORS[index % MACAROON_COLORS.length]
}

function DigitBubble({ digit, index }: { digit: string; index: number }) {
  const c = getColor(index)
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 100,
        height: 100,
        borderRadius: 24,
        backgroundColor: c.bg,
        border: `4px solid ${c.border}`,
        color: c.text,
        fontSize: 60,
        fontWeight: 800,
        margin: '0 8px',
        // Slight inner shadow effect via layered border
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
        marginBottom: 20,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          fontSize: 22,
          color: '#999',
          marginBottom: 12,
          fontWeight: 500,
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
          fontSize: 38,
          fontWeight: 700,
          color: '#4a4a4a',
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
          fontSize: 20,
          color: '#aaa',
          marginBottom: 28,
        },
      },
      `งวดวันที่ ${data.date}`
    )
  )

  // Top number
  if (data.top_number) {
    children.push(
      React.createElement(NumberRow, {
        key: 'top',
        label: 'เลขบน',
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
        label: 'เลขล่าง',
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
        label: 'เลขเต็ม',
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
          fontSize: 13,
          color: '#ccc',
          marginTop: 'auto',
          paddingTop: 16,
        },
      },
      'LottoBot'
    )
  )

  // Main container — clean white background
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
        background: '#ffffff',
        padding: 40,
        fontFamily: 'sans-serif',
      },
    },
    ...children
  )
}
