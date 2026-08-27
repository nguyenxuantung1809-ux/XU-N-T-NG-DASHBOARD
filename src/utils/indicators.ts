export function calculateRsi(values: number[], period: number) {
  const output = Array<number | null>(values.length).fill(null)
  if (values.length <= period) return output
  let averageGain = 0
  let averageLoss = 0

  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1]
    averageGain += Math.max(change, 0)
    averageLoss += Math.max(-change, 0)
  }
  averageGain /= period
  averageLoss /= period
  output[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1]
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period
    output[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
  }
  return output
}

function ema(values: Array<number | null>, period: number) {
  const output = Array<number | null>(values.length).fill(null)
  const multiplier = 2 / (period + 1)
  const seed: number[] = []
  let previous: number | null = null

  values.forEach((value, index) => {
    if (value === null) return
    if (previous === null) {
      seed.push(value)
      if (seed.length === period) {
        previous = seed.reduce((sum, item) => sum + item, 0) / period
        output[index] = previous
      }
      return
    }
    previous = (value - previous) * multiplier + previous
    output[index] = previous
  })
  return output
}

export function calculateMacd(values: number[], fast: number, slow: number, signalPeriod: number) {
  const fastLine = ema(values, fast)
  const slowLine = ema(values, slow)
  const macd = values.map((_, index) => {
    const fastValue = fastLine[index]
    const slowValue = slowLine[index]
    return fastValue === null || slowValue === null ? null : fastValue - slowValue
  })
  const signal = ema(macd, signalPeriod)
  const histogram = macd.map((value, index) =>
    value === null || signal[index] === null ? null : value - signal[index]!,
  )
  return { macd, signal, histogram }
}

function rollingMidpoint(highs: number[], lows: number[], period: number) {
  return highs.map((_, index) => {
    if (index < period - 1) return null
    const start = index - period + 1
    return (Math.max(...highs.slice(start, index + 1)) + Math.min(...lows.slice(start, index + 1))) / 2
  })
}

export function calculateIchimoku(
  highs: number[],
  lows: number[],
  tenkanPeriod: number,
  kijunPeriod: number,
  senkouBPeriod: number,
) {
  const tenkan = rollingMidpoint(highs, lows, tenkanPeriod)
  const kijun = rollingMidpoint(highs, lows, kijunPeriod)
  const spanBRaw = rollingMidpoint(highs, lows, senkouBPeriod)
  const projectedLength = highs.length + kijunPeriod
  const spanA = Array<number | null>(projectedLength).fill(null)
  const spanB = Array<number | null>(projectedLength).fill(null)

  for (let index = 0; index < highs.length; index += 1) {
    const target = index + kijunPeriod
    if (tenkan[index] !== null && kijun[index] !== null) {
      spanA[target] = (tenkan[index]! + kijun[index]!) / 2
    }
    if (spanBRaw[index] !== null) spanB[target] = spanBRaw[index]
  }
  return { tenkan, kijun, spanA, spanB }
}
