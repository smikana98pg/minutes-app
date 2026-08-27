import type { MetadataRoute } from 'next';

/**
 * Chrome に「アプリ」として扱わせるための宣言。
 *
 * standalone にしておくと、Chrome の --app ウィンドウでも
 * インストールした PWA でもアドレスバーの無い単独ウィンドウで開く。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '議事録',
    short_name: '議事録',
    description: '会議の音声から議事録を自動生成する',
    start_url: '/',
    display: 'standalone',
    background_color: '#1a1917',
    theme_color: '#23221f',
    icons: [
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/app-icon.png', sizes: '1024x1024', type: 'image/png' },
    ],
  };
}
