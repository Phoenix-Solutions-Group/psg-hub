export function score(value: number, maxValue: number, floor = 35) {
  if (maxValue <= 0) return floor
  return Math.round(floor + (value / maxValue) * (100 - floor))
}

export function buildWeatherDemandScore(weatherRelatedRate: number, stormDemandScore = 0) {
  const stormBoost = Math.min(25, Math.log10(Math.max(stormDemandScore, 0) + 1) * 6)
  return Math.min(100, Math.round(45 + Math.min(weatherRelatedRate * 1.5, 30) + stormBoost))
}

export function buildRepairDemandScore(
  accidents: number,
  maxAccidents: number,
  stormDemandScore = 0,
  maxStormDemandScore = 0
) {
  const accidentDemand = score(accidents, maxAccidents)
  const stormDemand = stormDemandScore > 0 ? score(stormDemandScore, maxStormDemandScore, 35) : 0
  return stormDemand
    ? Math.min(100, Math.round(accidentDemand * 0.74 + stormDemand * 0.26))
    : accidentDemand
}
