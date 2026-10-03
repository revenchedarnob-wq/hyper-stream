/** Store IDs of popular ad-blocking extensions (they do the same job as Shields). */
export const AD_BLOCKER_IDS = new Set([
  'ddkjiahejlhfcafbddmgiahcphecmpfh', // uBlock Origin Lite
  'cjpalhdlnbpafiamejdnhcphjbkeiagm', // uBlock Origin
  'bgnkhhnnamicmpeenaelnjfhikgbkllg', // AdGuard
  'gighmmpiobklfepjocnamgkkbiglidom', // AdBlock
  'cfhdojbkjhnklbpkdaibdccddilifddb', // Adblock Plus
  'odfafepnkmbhccpbejgmiehpchacaeak', // uBlock Origin (Edge)
  'pdffkfellgipmhklpdmokmckkkfcopbh', // AdGuard (Edge)
])

export const isAdBlocker = (ext: { id: string; storeId?: string | null }) =>
  AD_BLOCKER_IDS.has(ext.storeId || ext.id)
