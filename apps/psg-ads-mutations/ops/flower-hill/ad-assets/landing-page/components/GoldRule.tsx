type GoldRuleProps = {
  width?: string
}

export function GoldRule({ width = '48px' }: GoldRuleProps) {
  return (
    <div
      style={{ height: '1px', background: 'var(--gold)', width }}
      aria-hidden="true"
    />
  )
}
