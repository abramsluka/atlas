import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Providers from './providers'
import TabBar from './TabBar'
import OrbAssistant from '@/features/assistant/OrbAssistant'
import StarField from '@/components/StarField'
import PageTransition from '@/components/PageTransition'
import PullToRefresh from '@/components/PullToRefresh'
import DemoBanner from '@/components/DemoBanner'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Atlas',
  description: 'Your personal life OS',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Atlas',
    startupImage: '/apple-touch-icon.png',
  },
  icons: {
    apple: '/apple-touch-icon.png',
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png',   sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png',   sizes: '512x512', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      style={{ background: '#050508' }}
    >
      <body className="min-h-full text-white antialiased" style={{ background: '#050508' }}>
        <StarField />
        {/* position:relative WITHOUT z-index keeps content above the fixed StarField
            (both paint in DOM order) but avoids creating a stacking context. With a
            z-index here, every modal inside gets trapped below the fixed TabBar
            (z-50) and can never overlay it. */}
        <div style={{ position: 'relative' }}>
          <DemoBanner />
          <Providers>
            <PullToRefresh>
              <PageTransition>{children}</PageTransition>
            </PullToRefresh>
            <OrbAssistant />
          </Providers>
        </div>
        <TabBar />
      </body>
    </html>
  )
}
