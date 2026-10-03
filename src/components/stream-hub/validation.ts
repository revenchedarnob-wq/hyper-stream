/**
 * Turns what the user pasted into a downloadable address, or null.
 * Accepts full http(s) links and bare addresses like "youtube.com/watch?v=…".
 */
export function normalizeStreamUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? null : `https://${trimmed}`
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    // Needs a real host: "localhost" or something with a dot and a TLD.
    if (url.hostname !== 'localhost' && !/\.[a-z]{2,}$/i.test(url.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

export function isValidStreamUrl(str: string): boolean {
  return normalizeStreamUrl(str) !== null
}
