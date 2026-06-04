'use client'

import { useRef, useEffect } from 'react'

type SeamlessVideoLoopProps = {
  src: string
  crossfadeSec?: number
}

export function SeamlessVideoLoop({ src, crossfadeSec = 1.4 }: SeamlessVideoLoopProps) {
  const v1 = useRef<HTMLVideoElement>(null)
  const v2 = useRef<HTMLVideoElement>(null)
  const busy = useRef(false)
  const raf = useRef<number>(0)

  useEffect(() => {
    const a = v1.current
    const b = v2.current
    if (!a || !b) return

    function crossfade(from: HTMLVideoElement, to: HTMLVideoElement) {
      if (busy.current) return
      busy.current = true
      to.currentTime = 0
      to.play().catch(() => {})
      const ms = crossfadeSec * 1000
      const t0 = performance.now()
      cancelAnimationFrame(raf.current)

      function step(now: number) {
        const p = Math.min((now - t0) / ms, 1)
        from.style.opacity = String(1 - p)
        to.style.opacity = String(p)
        if (p < 1) {
          raf.current = requestAnimationFrame(step)
        } else {
          from.style.opacity = '0'
          to.style.opacity = '1'
          from.pause()
          from.currentTime = 0
          busy.current = false
        }
      }
      raf.current = requestAnimationFrame(step)
    }

    function watch(from: HTMLVideoElement, to: HTMLVideoElement) {
      return function () {
        if (busy.current || !from.duration) return
        if (from.duration - from.currentTime <= crossfadeSec + 0.05) {
          crossfade(from, to)
        }
      }
    }

    const wa = watch(a, b)
    const wb = watch(b, a)
    a.addEventListener('timeupdate', wa)
    b.addEventListener('timeupdate', wb)

    return () => {
      a.removeEventListener('timeupdate', wa)
      b.removeEventListener('timeupdate', wb)
      cancelAnimationFrame(raf.current)
    }
  }, [src, crossfadeSec])

  const base: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  }

  return (
    <>
      <video
        ref={v1}
        autoPlay
        muted
        playsInline
        preload="auto"
        style={{ ...base, opacity: 1 }}
      >
        <source src={src} type="video/mp4" />
      </video>
      <video
        ref={v2}
        muted
        playsInline
        preload="auto"
        style={{ ...base, opacity: 0 }}
      >
        <source src={src} type="video/mp4" />
      </video>
    </>
  )
}
