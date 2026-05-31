import type { Metadata } from 'next'
import { Gilda_Display, Jost } from 'next/font/google'
import './globals.css'

const gildaDisplay = Gilda_Display({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const jost = Jost({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Flower Hill Auto Body',
  description:
    'Long Island\'s premier certified collision repair center. OEM certified for EV, exotic, and German vehicles.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${gildaDisplay.variable} ${jost.variable}`}>
      <body>{children}</body>
    </html>
  )
}
