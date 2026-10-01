'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const icons = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  budget: <path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />,
  users: (
    <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />
  ),
  categories: <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01" />,
  account: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0" />,
}

export function Nav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname()
  const items = [
    { href: '/', label: 'Home', icon: icons.home },
    ...(isAdmin
      ? [
          { href: '/budget', label: 'Budget', icon: icons.budget },
          { href: '/categories', label: 'Categories', icon: icons.categories },
          { href: '/users', label: 'Members', icon: icons.users },
        ]
      : []),
    { href: '/account', label: 'Account', icon: icons.account },
  ]
  return (
    <nav className="nav">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className={path === it.href ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {it.icon}
          </svg>
          {it.label}
        </Link>
      ))}
    </nav>
  )
}
