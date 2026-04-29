export const PSG_COLORS = {
  foundationNavy: '#1E3A52',
  phoenixRed: '#B8483E',
  slate: '#4A4257',
  clarity: '#4A6B4D',
  canvas: '#FAF8F5',
  bone: '#F2EEE8',
  stone: '#E4DED5',
  iron: '#2A2826',
  mist: '#9A958E',
  catalyst: '#C28E3A',
  horizon: '#F2EEE8',
  hermes: '#8C362D',
} as const

export const EMI_TIER_COLORS = {
  excellent: PSG_COLORS.clarity,      // 95%+
  good: '#5BA85A',                    // 88-94%
  poor: PSG_COLORS.phoenixRed,        // below 88%
} as const
