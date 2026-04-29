import Link from 'next/link'
import type { AlertShop } from '@/types'

interface AlertPanelProps {
  alerts: AlertShop[]
  threshold: number
}

export function AlertPanel({ alerts, threshold }: AlertPanelProps) {
  return (
    <div className="rounded-lg border border-iron/20 bg-white p-4">
      <h3 className="text-sm font-semibold text-navy">
        Shops Below {threshold}%
      </h3>
      {alerts.length === 0 ? (
        <p className="mt-3 text-sm text-clarity">All shops above threshold</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {alerts.map((alert) => (
            <li key={alert.shop_name} className="flex items-center justify-between text-sm">
              <Link
                href={`/shops/${encodeURIComponent(alert.shop_name)}`}
                className="font-medium text-navy hover:underline truncate mr-2"
              >
                {alert.shop_name}
              </Link>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-semibold text-phoenix-red">
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
