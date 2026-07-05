'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const HIDDEN_ON = ['/login', '/journal/new']

const tabs = [
  {
    label: 'Home',
    href: '/',
    active: (p: string) => p === '/',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    label: 'Gym',
    href: '/gym',
    active: (p: string) => p.startsWith('/gym'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M6.5 6.5h1v11h-1z" />
        <path d="M16.5 6.5h1v11h-1z" />
        <path d="M7.5 12h9" />
        <path d="M2 10h4.5M2 14h4.5" />
        <path d="M17.5 10H22M17.5 14H22" />
      </svg>
    ),
  },
  {
    label: 'Health',
    href: '/health',
    active: (p: string) => p.startsWith('/health'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
  {
    label: 'Journal',
    href: '/journal',
    active: (p: string) => p.startsWith('/journal'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    label: 'Mentor',
    href: '/mentor',
    active: (p: string) => p.startsWith('/mentor'),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12 2a8 8 0 0 1 8 8c0 5.25-8 13-8 13S4 15.25 4 10a8 8 0 0 1 8-8z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    ),
  },
]

export default function TabBar() {
  const pathname = usePathname()

  if (HIDDEN_ON.includes(pathname)) return null

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-900 bg-[#050508]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex h-14">
        {tabs.map((tab) => {
          const isActive = tab.active(pathname)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-wide transition-colors ${
                isActive ? 'text-green-400' : 'text-zinc-600 active:text-zinc-400'
              }`}
              style={isActive ? { boxShadow: '0 -1px 8px rgba(74,222,128,0.08)' } : undefined}
            >
              {tab.icon}
              {tab.label}
              {isActive && <span className="w-1 h-1 rounded-full bg-green-400/70 mt-0.5" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
