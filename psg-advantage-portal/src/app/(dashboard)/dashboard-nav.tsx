'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface DashboardNavProps {
  role: 'psg_admin' | 'shop_owner' | 'read_only'
  shopId: string | null
}

export default function DashboardNav({ role, shopId }: DashboardNavProps) {
  const pathname = usePathname()

  const links =
    role === 'shop_owner' && shopId
      ? [{ href: `/shops/${encodeURIComponent(shopId)}`, label: 'My Shop' }]
      : [
          { href: '/', label: 'Dashboard' },
          { href: '/market-command', label: 'Market Command' },
          { href: '/market-map', label: 'Market Map' },
          { href: '/shops', label: 'Shops' },
          { href: '/marketing-intelligence', label: 'Marketing Intelligence' },
        ]

  return (
    <nav className="flex items-center gap-4 -mb-px">
      {links.map((link) => {
        const isActive =
          link.href === '/'
            ? pathname === '/'
            : pathname.startsWith(link.href)

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              isActive
                ? 'border-white text-white'
                : 'border-transparent text-white/60 hover:text-white/80'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
