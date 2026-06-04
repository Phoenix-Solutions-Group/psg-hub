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
          { href: '/customer-geography', label: 'Customer Geography' },
          { href: '/shops', label: 'Shops' },
          { href: '/marketing-intelligence', label: 'Marketing Intelligence' },
          { href: '/flower-hill', label: 'Flower Hill' },
        ]

  return (
    <nav className="-mb-px flex items-center gap-6 overflow-x-auto">
      {links.map((link) => {
        const isActive =
          link.href === '/'
            ? pathname === '/'
            : pathname.startsWith(link.href)

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`whitespace-nowrap border-b-2 pb-3 font-heading text-sm font-medium transition-colors duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
              isActive
                ? 'border-phoenix-red text-navy'
                : 'border-transparent text-slate hover:text-phoenix-red'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
