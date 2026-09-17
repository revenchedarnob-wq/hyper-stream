export function isValidStreamUrl(str: string): boolean {
  if (!str) return false
  const trimmed = str.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    return true
  }
  if (/^(rtmp|rtmps|magnet|hls|dash):/i.test(trimmed)) {
    return true
  }
  if (/\.(m3u8|mpd|ts|flv|mp4|mkv)(\?.*)?$/i.test(trimmed)) {
    return true
  }
  return false
}
