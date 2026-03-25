import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LottoBot — ระบบส่งผลหวยอัตโนมัติ",
  description: "ระบบส่งผลหวยต่างประเทศอัตโนมัติ ผ่าน Telegram → n8n → LINE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-thai antialiased bg-bg text-text-primary">
        {children}
      </body>
    </html>
  );
}
