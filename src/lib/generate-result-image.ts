// LottoBot — Generate lottery result image JSX for ImageResponse (next/og)
// Themes: Macaroon, Candy, Ocean, Gold, Dark, Shopee (bubble sticker)
// Layouts: horizontal (default), vertical

import React from 'react'

export interface ResultImageData {
  lottery_name: string
  flag: string
  date: string
  top_number?: string
  bottom_number?: string
  full_number?: string
  theme?: string
  font_style?: string // rounded | sharp | outline
  digit_size?: string // s | m | l
  layout?: string // horizontal | vertical
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
  shopee: {
    name: 'Shopee',
    background: '#FFF8E7',
    titleColor: '#5D4037',
    dateColor: '#8D6E63',
    labelColor: '#A1887F',
    footerColor: '#BCAAA4',
    digits: [
      { bg: 'transparent', text: '#F48FB1', border: 'transparent' },  // pink
      { bg: 'transparent', text: '#FFB74D', border: 'transparent' },  // orange
      { bg: 'transparent', text: '#AED581', border: 'transparent' },  // green
      { bg: 'transparent', text: '#81D4FA', border: 'transparent' },  // blue
      { bg: 'transparent', text: '#CE93D8', border: 'transparent' },  // purple
      { bg: 'transparent', text: '#FFF176', border: 'transparent' },  // yellow
      { bg: 'transparent', text: '#EF9A9A', border: 'transparent' },  // rose
      { bg: 'transparent', text: '#80CBC4', border: 'transparent' },  // teal
    ],
  },
}

function getTheme(name?: string): ThemeConfig {
  return THEMES[name || 'macaroon'] || THEMES.macaroon
}

const SIZE_CONFIG = {
  s: { box: 70, fontSize: 40, borderW: 3, radius: 16, gap: 6 },
  m: { box: 100, fontSize: 60, borderW: 4, radius: 24, gap: 8 },
  l: { box: 130, fontSize: 80, borderW: 5, radius: 30, gap: 10 },
}

const FONT_STYLES = {
  rounded: { fontWeight: 800, letterSpacing: 0 },
  sharp: { fontWeight: 900, letterSpacing: 2 },
  outline: { fontWeight: 700, letterSpacing: 0 },
}

function DigitBubble({ digit, index, theme, fontStyle, size }: {
  digit: string; index: number; theme: ThemeConfig; fontStyle: string; size: string
}) {
  const c = theme.digits[index % theme.digits.length]
  const sz = SIZE_CONFIG[size as keyof typeof SIZE_CONFIG] || SIZE_CONFIG.m
  const fs = FONT_STYLES[fontStyle as keyof typeof FONT_STYLES] || FONT_STYLES.rounded
  const isOutline = fontStyle === 'outline'
  const isShopee = theme.name === 'Shopee'

  // Text-stroke effect via textShadow (Satori doesn't support -webkit-text-stroke)
  const strokeColor = '#42210b'
  const s = 3 // stroke width
  const textStroke = isShopee
    ? `${s}px ${s}px 0 ${strokeColor}, -${s}px -${s}px 0 ${strokeColor}, ${s}px -${s}px 0 ${strokeColor}, -${s}px ${s}px 0 ${strokeColor}, ${s}px 0 0 ${strokeColor}, -${s}px 0 0 ${strokeColor}, 0 ${s}px 0 ${strokeColor}, 0 -${s}px 0 ${strokeColor}`
    : 'none'

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: isShopee ? sz.box * 1.15 : sz.box,
        height: isShopee ? sz.box * 1.15 : sz.box,
        borderRadius: isShopee ? '50%' : sz.radius,
        backgroundColor: isOutline ? 'transparent' : c.bg,
        border: isShopee ? 'none' : `${sz.borderW}px solid ${c.border}`,
        color: isOutline ? c.border : c.text,
        fontSize: isShopee ? sz.fontSize * 1.3 : sz.fontSize,
        fontWeight: 900,
        fontFamily: isShopee ? 'Sniglet, sans-serif' : 'sans-serif',
        letterSpacing: isShopee ? 0 : fs.letterSpacing,
        textShadow: textStroke,
        margin: `0 ${isShopee ? sz.gap + 2 : sz.gap}px`,
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
  fontStyle,
  size,
  layout,
}: {
  label: string
  number: string
  colorOffset: number
  theme: ThemeConfig
  fontStyle: string
  size: string
  layout: string
}) {
  const sz = SIZE_CONFIG[size as keyof typeof SIZE_CONFIG] || SIZE_CONFIG.m
  const isVertical = layout === 'vertical'
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginBottom: size === 'l' ? 24 : 20,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          fontSize: sz.box < 80 ? 18 : 22,
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
          flexDirection: isVertical ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: isVertical ? 8 : 0,
        },
      },
      ...number.split('').map((digit, i) =>
        React.createElement(DigitBubble, {
          key: i,
          digit,
          index: i + colorOffset,
          theme,
          fontStyle,
          size,
        })
      )
    )
  )
}

export function buildResultImageJSX(data: ResultImageData) {
  const theme = getTheme(data.theme)
  const fontStyle = data.font_style || 'rounded'
  const digitSize = data.digit_size || 'm'
  const layout = data.layout || 'horizontal'
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
        fontStyle,
        size: digitSize,
        layout,
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
        fontStyle,
        size: digitSize,
        layout,
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
        fontStyle,
        size: digitSize,
        layout,
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
