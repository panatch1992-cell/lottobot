import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: "#c9a84c",
        success: "#22a867",
        warn: "#e89b1c",
        danger: "#dc3545",
        bg: "#f5f3ee",
        "bg-card": "#ffffff",
        "text-primary": "#1a1a1a",
        "text-secondary": "#6b7280",
        "tg-dark": "#1a222c",
        "tg-bubble": "#2b5278",
        "line-green": "#06c755",
      },
      fontFamily: {
        thai: ['"IBM Plex Sans Thai"', "sans-serif"],
        mono: ['"Space Grotesk"', "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
