import Script from 'next/script'

type JsonLdProps = {
  id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
}

export function JsonLd({ id, data }: JsonLdProps) {
  return (
    <Script id={id} type="application/ld+json" strategy="beforeInteractive">
      {JSON.stringify(data)}
    </Script>
  )
}
