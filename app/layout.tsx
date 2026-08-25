import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '議事録',
  description: '会議の音声から議事録を自動生成する',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
