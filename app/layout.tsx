import type { Metadata, Viewport } from 'next'
import { RegisterSW } from '@/components/RegisterSW'
import './globals.css'

export const metadata: Metadata = {
  title: 'Family Expenses',
  description: 'Track family spending against monthly and weekly budgets',
  appleWebApp: { capable: true, title: 'Expenses', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  themeColor: '#0f766e',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  )
}
