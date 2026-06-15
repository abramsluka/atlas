import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Providers from './providers'
import TabBar from './TabBar'
import StarField from '@/components/StarField'
import PageTransition from '@/components/PageTransition'

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
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Providers>
            <PageTransition>{children}</PageTransition>
          </Providers>
        </div>
        <TabBar />
      </body>
    </html>
  )
}
