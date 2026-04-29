import Image from 'next/image'
import type { ReactNode } from 'react'

type PsgAuthFrameProps = {
  eyebrow: string
  title: string
  description: string
  asideTitle: string
  asideBody: string
  children: ReactNode
}

export default function PsgAuthFrame({
  eyebrow,
  title,
  description,
  asideTitle,
  asideBody,
  children,
}: PsgAuthFrameProps) {
  return (
    <main className="min-h-[100dvh] bg-paper px-4 py-8 font-body text-graphite sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-6xl flex-col justify-center">
        <div className="mb-10 flex items-center justify-between border-b border-stone pb-5">
          <Image
            src="/brand/assets/psg-logo-primary.svg"
            alt="Phoenix Solutions Group"
            width={214}
            height={54}
            priority
            className="h-auto w-44 sm:w-52"
          />
          <p className="hidden font-heading text-[11px] font-medium uppercase text-mist sm:block">
            Since 1989
          </p>
        </div>

        <section className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:items-center">
          <div className="max-w-xl">
            <p className="font-heading text-[11px] font-medium uppercase text-phoenix-red">
              {eyebrow}
            </p>
            <h1 className="mt-5 font-heading text-4xl font-light leading-[1.08] text-navy sm:text-5xl lg:text-6xl">
              {title}
            </h1>
            <p className="mt-6 max-w-lg text-base leading-[1.65] text-iron/75 sm:text-lg">
              {description}
            </p>

            <div className="mt-10 border-l border-stone pl-5">
              <p className="font-heading text-sm font-medium text-slate">{asideTitle}</p>
              <p className="mt-2 text-sm leading-[1.65] text-mist">{asideBody}</p>
            </div>
          </div>

          <div className="border border-stone bg-bone p-2 shadow-[0_32px_64px_-28px_rgba(30,58,82,0.22)]">
            <div className="border border-stone/80 bg-white p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] sm:p-8 lg:p-10">
              {children}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
