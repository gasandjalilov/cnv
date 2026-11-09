import { useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/settings'

export type ResolvedTheme = 'light' | 'dark'

function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  return mode === 'dark' || (mode === 'system' && systemDark) ? 'dark' : 'light'
}

export function useTheme(mode: ThemeMode): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(mode, window.matchMedia('(prefers-color-scheme: dark)').matches)
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const next = resolveTheme(mode, media.matches)
      document.documentElement.dataset.theme = next
      setResolved(next)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [mode])

  return resolved
}
