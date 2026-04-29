import Link from 'next/link'
import type { AlertShop } from '@/types'

interface AlertPanelProps {
  alerts: AlertShop[]
  threshold: number
}

export function AlertPanel({ alerts, threshold }: AlertPanelProps) {
  return (
    <div className="border border-stone bg-white p-5 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <p className="font-heading text-xs font-medium uppercase text-phoenix-red">
        Attention needed
      </p>
      <h3 className="mt-2 font-heading text-base font-medium text-navy">
        Shops Below {threshold}%
      </h3>
      {alerts.length === 0 ? (
        <p className="mt-4 text-sm text-slate">All shops are above threshold.</p>
      ) : (
        <ul className="mt-4 divide-y divide-stone">
          {alerts.map((alert) => (
            <li key={alert.shop_name} className="flex items-center justify-between gap-4 py-3 text-sm">
              <Link
                href={`/shops/${encodeURIComponent(alert.shop_name)}`}
                className="mr-2 truncate font-heading font-medium text-navy underline-offset-4 hover:text-phoenix-red hover:underline"
              >
                {alert.shop_name}
              </Link>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-medium text-phoenix-red">
                  {alert.avg_emi_pct}%
                </span>
                <span className="text-xs text-iron">
                  {alert.months_below}mo
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
