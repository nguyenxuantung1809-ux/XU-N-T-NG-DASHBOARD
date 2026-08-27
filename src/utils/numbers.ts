export function parseNumber(value: string): number | null {
  const normalized = value.trim().replace(/[\s,]/g, '')
  if (!normalized) return null
  const match = /^([-+]?(?:\d+\.?\d*|\.\d+))([KMB])?$/i.exec(normalized)
  if (!match) return null
  const multiplier = match[2]
    ? ({ K: 1_000, M: 1_000_000, B: 1_000_000_000 } as const)[match[2].toUpperCase() as 'K' | 'M' | 'B']
    : 1
  const number = Number(match[1]) * multiplier
  return Number.isFinite(number) ? number : null
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
  }).format(value)
}
