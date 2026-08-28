type NullableSeries = Array<number | null>

function sanitizePeriod(period: number, fallback = 14) {
  const value = Math.round(Number(period) || fallback)
  return Math.max(value, 1)
}

function rollingSma(values: NullableSeries, period: number): NullableSeries {
  const safePeriod = sanitizePeriod(period)
  const output = Array<number | null>(values.length).fill(null)
  let sum = 0
  let validCount = 0

  values.forEach((value, index) => {
    if (value !== null) {
      sum += value
      validCount += 1
    }
    const oldValue = values[index - safePeriod]
    if (oldValue !== undefined && oldValue !== null) {
      sum -= oldValue
      validCount -= 1
    }
    if (index >= safePeriod - 1 && validCount === safePeriod) {
      output[index] = sum / safePeriod
    }
  })
  return output
}

function wilderAverage(values: NullableSeries, period: number): NullableSeries {
  const safePeriod = sanitizePeriod(period)
  const output = Array<number | null>(values.length).fill(null)
  const seed: number[] = []
  let previous: number | null = null

  values.forEach((value, index) => {
    if (value === null) return
    if (previous === null) {
      seed.push(value)
      if (seed.length === safePeriod) {
        previous = seed.reduce((sum, item) => sum + item, 0) / safePeriod
        output[index] = previous
      }
      return
    }
    previous = (previous * (safePeriod - 1) + value) / safePeriod
    output[index] = previous
  })
  return output
}

export function calculateSma(values: number[], period: number) {
  return rollingSma(values, period)
}

function ema(values: NullableSeries, period: number) {
  const safePeriod = sanitizePeriod(period)
  const output = Array<number | null>(values.length).fill(null)
  const multiplier = 2 / (safePeriod + 1)
  const seed: number[] = []
  let previous: number | null = null

  values.forEach((value, index) => {
    if (value === null) return
    if (previous === null) {
      seed.push(value)
      if (seed.length === safePeriod) {
        previous = seed.reduce((sum, item) => sum + item, 0) / safePeriod
        output[index] = previous
      }
      return
    }
    previous = (value - previous) * multiplier + previous
    output[index] = previous
  })
  return output
}

export function calculateEma(values: number[], period: number) {
  return ema(values, period)
}

export function calculateWma(values: number[], period: number) {
  const safePeriod = sanitizePeriod(period)
  const output = Array<number | null>(values.length).fill(null)
  const denominator = safePeriod * (safePeriod + 1) / 2

  for (let index = safePeriod - 1; index < values.length; index += 1) {
    let sum = 0
    let valid = true
    for (let offset = 0; offset < safePeriod; offset += 1) {
      const value = values[index - offset]
      if (!Number.isFinite(value)) {
        valid = false
        break
      }
      sum += value * (safePeriod - offset)
    }
    if (valid) output[index] = sum / denominator
  }
  return output
}

export function calculateBollinger(values: number[], period: number, multiplier: number) {
  const safePeriod = sanitizePeriod(period, 20)
  const safeMultiplier = Math.max(Number(multiplier) || 2, 0.1)
  const middle = calculateSma(values, safePeriod)
  const upper = Array<number | null>(values.length).fill(null)
  const lower = Array<number | null>(values.length).fill(null)

  for (let index = safePeriod - 1; index < values.length; index += 1) {
    const average = middle[index]
    if (average === null) continue
    const window = values.slice(index - safePeriod + 1, index + 1)
    const variance = window.reduce((sum, value) => sum + (value - average) ** 2, 0) / safePeriod
    const deviation = Math.sqrt(variance)
    upper[index] = average + deviation * safeMultiplier
    lower[index] = average - deviation * safeMultiplier
  }
  return { middle, upper, lower }
}

export function calculateVwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: Array<number | null>,
) {
  const output = Array<number | null>(closes.length).fill(null)
  let cumulativePriceVolume = 0
  let cumulativeVolume = 0

  closes.forEach((close, index) => {
    const typicalPrice = (highs[index] + lows[index] + close) / 3
    const volume = Number(volumes[index])
    const weight = Number.isFinite(volume) && volume > 0 ? volume : 1
    cumulativePriceVolume += typicalPrice * weight
    cumulativeVolume += weight
    output[index] = cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null
  })
  return output
}

export function calculateTrueRange(highs: number[], lows: number[], closes: number[]) {
  return highs.map((high, index) => {
    const low = lows[index]
    const previousClose = index === 0 ? closes[index] : closes[index - 1]
    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    )
  })
}

export function calculateAtr(highs: number[], lows: number[], closes: number[], period: number) {
  return wilderAverage(calculateTrueRange(highs, lows, closes), period)
}

export function calculateRsi(values: number[], period: number) {
  const safePeriod = sanitizePeriod(period, 14)
  const output = Array<number | null>(values.length).fill(null)
  if (values.length <= safePeriod) return output
  let averageGain = 0
  let averageLoss = 0

  for (let index = 1; index <= safePeriod; index += 1) {
    const change = values[index] - values[index - 1]
    averageGain += Math.max(change, 0)
    averageLoss += Math.max(-change, 0)
  }
  averageGain /= safePeriod
  averageLoss /= safePeriod
  output[safePeriod] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)

  for (let index = safePeriod + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1]
    averageGain = (averageGain * (safePeriod - 1) + Math.max(change, 0)) / safePeriod
    averageLoss = (averageLoss * (safePeriod - 1) + Math.max(-change, 0)) / safePeriod
    output[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
  }
  return output
}

export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number,
  dPeriod: number,
) {
  const safeK = sanitizePeriod(kPeriod, 14)
  const rawK = Array<number | null>(closes.length).fill(null)
  for (let index = safeK - 1; index < closes.length; index += 1) {
    const start = index - safeK + 1
    const highest = Math.max(...highs.slice(start, index + 1))
    const lowest = Math.min(...lows.slice(start, index + 1))
    rawK[index] = highest === lowest ? 50 : (closes[index] - lowest) / (highest - lowest) * 100
  }
  const d = rollingSma(rawK, dPeriod)
  return { k: rawK, d }
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

export function calculateAdx(highs: number[], lows: number[], closes: number[], period: number) {
  const plusDm = Array<number | null>(closes.length).fill(0)
  const minusDm = Array<number | null>(closes.length).fill(0)
  for (let index = 1; index < closes.length; index += 1) {
    const upMove = highs[index] - highs[index - 1]
    const downMove = lows[index - 1] - lows[index]
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0
  }

  const atr = calculateAtr(highs, lows, closes, period)
  const plusSmooth = wilderAverage(plusDm, period)
  const minusSmooth = wilderAverage(minusDm, period)
  const plusDi = closes.map((_, index) => {
    const range = atr[index]
    const value = plusSmooth[index]
    return range === null || value === null || range === 0 ? null : value / range * 100
  })
  const minusDi = closes.map((_, index) => {
    const range = atr[index]
    const value = minusSmooth[index]
    return range === null || value === null || range === 0 ? null : value / range * 100
  })
  const dx = closes.map((_, index) => {
    const plus = plusDi[index]
    const minus = minusDi[index]
    if (plus === null || minus === null || plus + minus === 0) return null
    return Math.abs(plus - minus) / (plus + minus) * 100
  })
  return { adx: wilderAverage(dx, period), plusDi, minusDi }
}

export function calculateObv(closes: number[], volumes: Array<number | null>) {
  const output = Array<number | null>(closes.length).fill(null)
  let obv = 0
  closes.forEach((close, index) => {
    if (index === 0) {
      output[index] = 0
      return
    }
    const volume = Number(volumes[index])
    const safeVolume = Number.isFinite(volume) ? volume : 0
    if (close > closes[index - 1]) obv += safeVolume
    if (close < closes[index - 1]) obv -= safeVolume
    output[index] = obv
  })
  return output
}

export function calculateSupertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
  multiplier: number,
) {
  const safeMultiplier = Math.max(Number(multiplier) || 3, 0.1)
  const atr = calculateAtr(highs, lows, closes, period)
  const line = Array<number | null>(closes.length).fill(null)
  const direction = Array<1 | -1 | null>(closes.length).fill(null)
  const upperBand = Array<number | null>(closes.length).fill(null)
  const lowerBand = Array<number | null>(closes.length).fill(null)

  for (let index = 0; index < closes.length; index += 1) {
    const range = atr[index]
    if (range === null) continue
    const midpoint = (highs[index] + lows[index]) / 2
    const basicUpper = midpoint + safeMultiplier * range
    const basicLower = midpoint - safeMultiplier * range
    const previousUpper = upperBand[index - 1]
    const previousLower = lowerBand[index - 1]

    upperBand[index] = previousUpper !== null && basicUpper >= previousUpper && closes[index - 1] <= previousUpper
      ? previousUpper
      : basicUpper
    lowerBand[index] = previousLower !== null && basicLower <= previousLower && closes[index - 1] >= previousLower
      ? previousLower
      : basicLower

    const previousLine = line[index - 1]
    const previousDirection = direction[index - 1]
    if (previousLine === null || previousDirection === null) {
      direction[index] = closes[index] >= midpoint ? 1 : -1
      line[index] = direction[index] === 1 ? lowerBand[index] : upperBand[index]
      continue
    }

    if (previousDirection === -1) {
      direction[index] = closes[index] > upperBand[index]! ? 1 : -1
    } else {
      direction[index] = closes[index] < lowerBand[index]! ? -1 : 1
    }
    line[index] = direction[index] === 1 ? lowerBand[index] : upperBand[index]
  }

  return { line, direction }
}

function rollingMidpoint(highs: number[], lows: number[], period: number) {
  const safePeriod = sanitizePeriod(period)
  return highs.map((_, index) => {
    if (index < safePeriod - 1) return null
    const start = index - safePeriod + 1
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
  const safeKijun = sanitizePeriod(kijunPeriod, 26)
  const tenkan = rollingMidpoint(highs, lows, tenkanPeriod)
  const kijun = rollingMidpoint(highs, lows, safeKijun)
  const spanBRaw = rollingMidpoint(highs, lows, senkouBPeriod)
  const projectedLength = highs.length + safeKijun
  const spanA = Array<number | null>(projectedLength).fill(null)
  const spanB = Array<number | null>(projectedLength).fill(null)

  for (let index = 0; index < highs.length; index += 1) {
    const target = index + safeKijun
    if (tenkan[index] !== null && kijun[index] !== null) {
      spanA[target] = (tenkan[index]! + kijun[index]!) / 2
    }
    if (spanBRaw[index] !== null) spanB[target] = spanBRaw[index]
  }
  return { tenkan, kijun, spanA, spanB }
}
