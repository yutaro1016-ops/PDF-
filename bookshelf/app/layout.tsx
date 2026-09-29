import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF本棚",
  description: "資料を保存し、タイトルと本文を横断検索するPDF本棚。",
  other: {
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
