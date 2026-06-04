/**
 * PSG Design Tokens — JS mirror of globals.css @theme block.
 *
 * Use this for any context where Tailwind utility classes don't reach:
 *   - Recharts props (stroke, fill, etc.)
 *   - MapLibre paint properties
 *   - Raw SVG attributes
 *   - Inline styles for dynamic values
 *
 * SINGLE SOURCE OF TRUTH: Values here MUST match globals.css @theme.
 * If you update one, update both.
 */

export const PSG_TOKENS = {
  // Brand primary
  navy: '#1E3A52',
  navyDeep: '#142838',
  phoenixRed: '#B8483E',
  phoenixRedDeep: '#8C362D',
  slate: '#4A4257',

  // Neutrals
  paper: '#FAFAFA',
  bone: '#F0F0F0',
  stone: '#E0E0E0',
  fog: '#C4C4C4',
  mist: '#949494',
  graphite: '#2A2A2A',
  iron: '#161616',

  // Semantic state
  success: '#0EA5A5',
  successBg: '#E6F7F7',
  successDeep: '#0A7F7F',
  grove: '#4A6B4D',
  groveBg: '#EEF3EE',
  warning: '#C28E3A',
  warningBg: '#FBF3E4',
  warningDeep: '#8E6620',
  danger: '#B8483E',
  dangerBg: '#FAEEEC',
  dangerDeep: '#8C362D',
  info: '#FF8700',

  // Map cluster heat scale
  mapCluster1: '#DCE8EC',
  mapCluster2: '#AFC9D2',
  mapCluster3: '#7FA8B8',
  mapCluster4: '#527F95',

  // Pure tones (raw SVG/icon use only)
  white: '#FFFFFF',
} as const

/**
 * EMI score color thresholds.
 * Maps a score tier to its semantic token.
 */
export const EMI_TIER_COLORS = {
  excellent: PSG_TOKENS.success,    // 95%+
  good: PSG_TOKENS.grove,           // 88-94%
  poor: PSG_TOKENS.danger,          // below 88%
} as const

/**
 * Chart styling defaults — apply consistently across all Recharts instances.
 */
export const CHART_DEFAULTS = {
  gridStroke: PSG_TOKENS.stone,
  axisStroke: PSG_TOKENS.mist,
  axisText: PSG_TOKENS.slate,
  tooltipBg: '#FFFFFF',
  tooltipBorder: PSG_TOKENS.stone,
} as const

/**
 * Legacy export — preserved for files still importing PSG_COLORS.
 * Prefer PSG_TOKENS in new code.
 * @deprecated Use PSG_TOKENS instead
 */
export const PSG_COLORS = {
  foundationNavy: PSG_TOKENS.navy,
  phoenixRed: PSG_TOKENS.phoenixRed,
  slate: PSG_TOKENS.slate,
  clarity: PSG_TOKENS.success,
  canvas: PSG_TOKENS.paper,
  bone: PSG_TOKENS.bone,
  stone: PSG_TOKENS.stone,
  iron: PSG_TOKENS.iron,
  mist: PSG_TOKENS.mist,
  catalyst: PSG_TOKENS.warning,
  horizon: PSG_TOKENS.successBg,
  hermes: PSG_TOKENS.info,
} as const
