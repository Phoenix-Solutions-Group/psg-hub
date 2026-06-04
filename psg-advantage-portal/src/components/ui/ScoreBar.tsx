interface ScoreBarProps {
  label: string
  value: number | null
  isFlagged?: boolean
}

export default function ScoreBar({ label, value, isFlagged = false }: ScoreBarProps) {
  if (value === null) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-iron">{label}</span>
        <div className="h-2 rounded bg-iron/10" />
        <span className="text-xs text-iron">N/A</span>
      </div>
    )
  }

  const barColor = isFlagged ? 'bg-phoenix-red' : 'bg-clarity'
  const textColor = isFlagged ? 'text-phoenix-red' : 'text-navy'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${textColor}`}>{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-medium ${textColor}`}>
            {value.toFixed(1)}%
          </span>
          {isFlagged && (
            <span className="bg-danger-bg px-1.5 py-0.5 text-[10px] font-medium text-danger-deep">
              Below avg
            </span>
          )}
        </div>
      </div>
      <div className="h-2 rounded bg-iron/10">
        <div
          className={`h-2 rounded ${barColor}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  )
}
