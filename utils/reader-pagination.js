// Match the reader's font stack; measure Latin words instead of counting them as CJK glyphs.
const READER_FONT_FAMILY = '"PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans CJK SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'

function createTextMeasurer(fontSize, canvasContext) {
  if (canvasContext) canvasContext.font = `500 ${fontSize}px ${READER_FONT_FAMILY}`
  return (text) => {
    if (canvasContext) {
      try {
        const width = canvasContext.measureText(text).width
        if (Number.isFinite(width) && width > 0) return width
      } catch (_) { /* Older devices use the conservative glyph-width fallback. */ }
    }
    return Array.from(text).reduce((width, char) => {
      if (/\s/.test(char)) return width + fontSize * 0.35
      if (/[ilI.,'!:;|]/.test(char)) return width + fontSize * 0.35
      if (/[MWmw@%&]/.test(char)) return width + fontSize
      if (/[A-Z]/.test(char)) return width + fontSize * 0.75
      if (/[\x20-\x7e]/.test(char)) return width + fontSize * 0.62
      return width + fontSize * 1.05
    }, 0)
  }
}

// Keep ordinary English words together. A word longer than a whole line is the
// only Latin token we break; the CSS uses overflow-wrap for the same case.
function wrapTextLines(text, maxWidth, measure) {
  const tokens = text.match(/[A-Za-z0-9\u00c0-\u024f]+(?:['’\-][A-Za-z0-9\u00c0-\u024f]+)*|\s+|[^\s]/gu) || []
  const groups = []
  for (const token of tokens) {
    if (groups.length && /^[，。！？；：、）】》」』,.!?;:)]$/.test(token)) {
      groups[groups.length - 1] += token
    } else if (groups.length && /^[（【《「『(]$/.test(groups[groups.length - 1])) {
      groups[groups.length - 1] += token
    } else {
      groups.push(token)
    }
  }
  const lines = []
  let line = ''
  const append = (token) => {
    if (line.trim() && measure((line + token).trim()) > maxWidth) {
      lines.push(line)
      line = ''
    }
    line += token
  }
  for (const token of groups) {
    if (measure(token.trim()) > maxWidth) {
      // overflow-wrap: break-word first moves an oversized word to a fresh
      // line. Counting it in the previous line's spare space underestimates height.
      if (line.trim()) {
        lines.push(line)
        line = ''
      }
      for (const char of Array.from(token)) append(char)
    } else {
      append(token)
    }
  }
  if (line) lines.push(line)
  return lines
}

module.exports = { createTextMeasurer, wrapTextLines }
