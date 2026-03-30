// LottoBot — Generate lottery result image JSX for ImageResponse (next/og)
// Multiple themes: Macaroon, Candy, Ocean, Gold, Dark

import React from 'react'

export interface ResultImageData {
  lottery_name: string
  flag: string
  date: string
  top_number?: string
  bottom_number?: string
  full_number?: string
  theme?: string // macaroon | candy | ocean | gold | dark
}

interface DigitColor {
  bg: string
  text: string
  border: string
}

interface ThemeConfig {
  name: string
  background: string
  titleColor: string
  dateColor: string
  labelColor: string
  footerColor: string
  digits: DigitColor[]
}

export const THEMES: Record<string, ThemeConfig> = {
  macaroon: {
    name: 'Macaroon',
    background: '#ffffff',
    titleColor: '#4a4a4a',
    dateColor: '#aaa',
    labelColor: '#999',
    footerColor: '#ccc',
    digits: [
      { bg: '#FFD1DC', text: '#D4526E', border: '#F8A5B8' },
      { bg: '#FFE5B4', text: '#CC8400', border: '#FFD080' },
      { bg: '#FFFACD', text: '#B8960C', border: '#FFE44D' },
      { bg: '#C1F0C1', text: '#2D8B2D', border: '#8ED88E' },
      { bg: '#B8E0FF', text: '#2E6DA4', border: '#80C4FF' },
      { bg: '#E0C8FF', text: '#7B4DBF', border: '#C89EFF' },
    ],
  },
  candy: {
    name: 'Candy',
    background: '#FFF5F5',
    titleColor: '#E53E3E',
    dateColor: '#FC8181',
    labelColor: '#F687B3',
    footerColor: '#FEB2B2',
    digits: [
      { bg: '#FF6B8A', text: '#fff', border: '#FF4D73' },
      { bg: '#FF9F43', text: '#fff', border: '#FF8C1A' },
      { bg: '#FFDD59', text: '#7C6800', border: '#FFD42A' },
      { bg: '#FF6B8A', text: '#fff', border: '#FF4D73' },
      { bg: '#FF9F43', text: '#fff', border: '#FF8C1A' },
      { bg: '#FF6B8A', text: '#fff', border: '#FF4D73' },
    ],
  },
  ocean: {
    name: 'Ocean',
    background: '#EBF8FF',
    titleColor: '#2B6CB0',
    dateColor: '#63B3ED',
    labelColor: '#90CDF4',
    footerColor: '#BEE3F8',
    digits: [
      { bg: '#2B6CB0', text: '#fff', border: '#2C5282' },
      { bg: '#3182CE', text: '#fff', border: '#2B6CB0' },
      { bg: '#4299E1', text: '#fff', border: '#3182CE' },
      { bg: '#0987A0', text: '#fff', border: '#086F83' },
      { bg: '#38B2AC', text: '#fff', border: '#2C7A7B' },
      { bg: '#4FD1C5', text: '#234E52', border: '#38B2AC' },
    ],
  },
  gold: {
    name: 'Gold',
    background: '#FFFBEB',
    titleColor: '#92400E',
    dateColor: '#D97706',
    labelColor: '#B45309',
    footerColor: '#FCD34D',
    digits: [
      { bg: '#F59E0B', text: '#fff', border: '#D97706' },
      { bg: '#FBBF24', text: '#78350F', border: '#F59E0B' },
      { bg: '#FCD34D', text: '#78350F', border: '#FBBF24' },
      { bg: '#F59E0B', text: '#fff', border: '#D97706' },
      { bg: '#FBBF24', text: '#78350F', border: '#F59E0B' },
      { bg: '#FCD34D', text: '#78350F', border: '#FBBF24' },
    ],
  },
  dark: {
    name: 'Dark',
    background: '#1A202C',
    titleColor: '#F7FAFC',
    dateColor: '#A0AEC0',
    labelColor: '#718096',
    footerColor: '#4A5568',
    digits: [
      { bg: '#E53E3E', text: '#fff', border: '#C53030' },
      { bg: '#DD6B20', text: '#fff', border: '#C05621' },
      { bg: '#D69E2E', text: '#fff', border: '#B7791F' },
      { bg: '#38A169', text: '#fff', border: '#2F855A' },
      { bg: '#3182CE', text: '#fff', border: '#2B6CB0' },
      { bg: '#805AD5', text: '#fff', border: '#6B46C1' },
    ],
  },
}

function getTheme(name?: string): ThemeConfig {
  return THEMES[name || 'macaroon'] || THEMES.macaroon
}

function DigitBubble({ digit, index, theme }: { digit: string; index: number; theme: ThemeConfig }) {
  const c = theme.digits[index % theme.digits.length]
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
      },
    },
    digit
  )
}

function NumberRow({
  label,
  number,
  colorOffset,
  theme,
}: {
  label: string
  number: string
  colorOffset: number
  theme: ThemeConfig
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
          color: theme.labelColor,
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
          theme,
        })
      )
    )
  )
}

export function buildResultImageJSX(data: ResultImageData) {
  const theme = getTheme(data.theme)
  const children: React.ReactNode[] = []

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
          color: theme.titleColor,
          marginBottom: 4,
        },
      },
      `${data.flag} ${data.lottery_name} ${data.flag}`
    )
  )

  children.push(
    React.createElement(
      'div',
      {
        key: 'date',
        style: {
          display: 'flex',
          fontSize: 20,
          color: theme.dateColor,
          marginBottom: 28,
        },
      },
      `งวดวันที่ ${data.date}`
    )
  )

  if (data.top_number) {
    children.push(
      React.createElement(NumberRow, {
        key: 'top',
        label: 'เลขบน',
        number: data.top_number,
        colorOffset: 0,
        theme,
      })
    )
  }

  if (data.bottom_number) {
    children.push(
      React.createElement(NumberRow, {
        key: 'bottom',
        label: 'เลขล่าง',
        number: data.bottom_number,
        colorOffset: 3,
        theme,
      })
    )
  }

  if (data.full_number) {
    children.push(
      React.createElement(NumberRow, {
        key: 'full',
        label: 'เลขเต็ม',
        number: data.full_number,
        colorOffset: 0,
        theme,
      })
    )
  }

  children.push(
    React.createElement(
      'div',
      {
        key: 'footer',
        style: {
          display: 'flex',
          fontSize: 13,
          color: theme.footerColor,
          marginTop: 'auto',
          paddingTop: 16,
        },
      },
      'LottoBot'
    )
  )

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
        background: theme.background,
        padding: 40,
        fontFamily: 'sans-serif',
      },
    },
    ...children
  )
}
