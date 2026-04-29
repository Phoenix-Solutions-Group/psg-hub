export const PSG_COLORS = {
  foundationNavy: '#1E3A52',
  phoenixRed: '#B8483E',
  clarity: '#0EA5A5',
  canvas: '#F8F6F3',
  iron: '#4A4E57',
  catalyst: '#D4A847',
  horizon: '#E6F7F7',
  hermes: '#FF8700',
} as const

export const EMI_TIER_COLORS = {
  excellent: PSG_COLORS.clarity,      // 95%+
  good: '#5BA85A',                    // 88-94%
  poor: PSG_COLORS.phoenixRed,        // below 88%
} as const
