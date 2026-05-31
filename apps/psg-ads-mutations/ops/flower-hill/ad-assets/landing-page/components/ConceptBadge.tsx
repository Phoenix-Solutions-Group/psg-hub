type ConceptBadgeProps = {
  text: string
}

export function ConceptBadge({ text }: ConceptBadgeProps) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-body)',
        fontWeight: 500,
        letterSpacing: '0.1em',
        color: 'var(--text-muted)',
        fontSize: 'var(--text-sm)',
        textTransform: 'uppercase',
      }}
    >
      {text}
    </span>
  )
}
