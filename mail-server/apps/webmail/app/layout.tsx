import type { Metadata } from 'next';
import { Cormorant_Garamond, Noto_Sans_SC } from 'next/font/google';

import { AppProviders } from '@/components/providers/app-providers';

import './globals.css';

const fontSans = Noto_Sans_SC({
  preload: false,
  variable: '--font-sans',
  weight: ['400', '500', '700'],
});

const fontSerif = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Stalwart Webmail',
  description: '面向终端用户的 Stalwart Webmail 壳层。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${fontSans.variable} ${fontSerif.variable}`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
