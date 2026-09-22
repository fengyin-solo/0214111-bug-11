/**
 * Markdown parser utilities.
 * Parses raw markdown text and identifies syntax regions for decoration.
 *
 * Each region has: { type, from, to, contentFrom, contentTo, meta }
 * - from/to: full range including syntax markers
 * - contentFrom/contentTo: range of the actual content (excluding markers)
 * - meta: additional info (heading level, language, url, etc.)
 */

/**
 * @typedef {Object} MarkdownRegion
 * @property {string} type
 * @property {number} from
 * @property {number} to
 * @property {number} contentFrom
 * @property {number} contentTo
 * @property {Object} [meta]
 */

/**
 * Parse a document string and return all markdown regions.
 * @param {string} doc - The full document text
 * @returns {MarkdownRegion[]}
 */
export function parseMarkdownRegions(doc) {
  const regions = []
  const lines = doc.split('\n')
  let pos = 0
  let inCodeBlock = false
  let codeBlockStart = -1
  let codeBlockLang = ''
  let codeBlockMarkerLen = 0
  let codeBlockMarkerChar = ''
  let codeBlockOpeningTo = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineStart = pos
    const lineEnd = pos + line.length

    // Code block fences
    const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      const isClosingFence = inCodeBlock &&
        marker[0] === codeBlockMarkerChar &&
        marker.length >= codeBlockMarkerLen &&
        fenceMatch[2].trim() === ''

      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockStart = lineStart
        codeBlockOpeningTo = lineEnd
        codeBlockLang = fenceMatch[2].trim()
        codeBlockMarkerLen = marker.length
        codeBlockMarkerChar = marker[0]
        pos = lineEnd + 1
        continue
      } else if (isClosingFence) {
        regions.push({
          type: 'code-block',
          from: codeBlockStart,
          to: lineEnd,
          contentFrom: codeBlockStart,
          contentTo: lineEnd,
          meta: {
            language: codeBlockLang,
            openingFrom: codeBlockStart,
            openingTo: codeBlockOpeningTo,
            closingFrom: lineStart,
            closingTo: lineEnd
          }
        })
        inCodeBlock = false
        codeBlockStart = -1
        codeBlockOpeningTo = -1
        codeBlockLang = ''
        codeBlockMarkerLen = 0
        codeBlockMarkerChar = ''
        pos = lineEnd + 1
        continue
      }
    }

    if (inCodeBlock) {
      pos = lineEnd + 1
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const markEnd = lineStart + level
      regions.push({
        type: 'heading',
        from: lineStart,
        to: lineEnd,
        contentFrom: markEnd + 1,
        contentTo: lineEnd,
        meta: { level, markFrom: lineStart, markTo: markEnd + 1 }
      })
      pos = lineEnd + 1
      continue
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      regions.push({
        type: 'hr',
        from: lineStart,
        to: lineEnd,
        contentFrom: lineStart,
        contentTo: lineEnd,
        meta: {}
      })
      pos = lineEnd + 1
      continue
    }

    // Blockquote
    const bqMatch = line.match(/^(>\s?)(.*)$/)
    if (bqMatch) {
      regions.push({
        type: 'blockquote',
        from: lineStart,
        to: lineEnd,
        contentFrom: lineStart + bqMatch[1].length,
        contentTo: lineEnd,
        meta: { markFrom: lineStart, markTo: lineStart + bqMatch[1].length }
      })
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)([-*+])\s(.+)$/)
    if (ulMatch) {
      const indent = ulMatch[1].length
      const markerStart = lineStart + indent
      regions.push({
        type: 'list-bullet',
        from: lineStart,
        to: lineEnd,
        contentFrom: markerStart + 2,
        contentTo: lineEnd,
        meta: { marker: ulMatch[2], markerFrom: markerStart, markerTo: markerStart + 1, indent }
      })
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)\.\s(.+)$/)
    if (olMatch) {
      const indent = olMatch[1].length
      const markerStart = lineStart + indent
      const markerEnd = markerStart + olMatch[2].length + 1
      regions.push({
        type: 'list-ordered',
        from: lineStart,
        to: lineEnd,
        contentFrom: markerEnd + 1,
        contentTo: lineEnd,
        meta: { number: olMatch[2], markerFrom: markerStart, markerTo: markerEnd, indent }
      })
    }

    // Task list
    const taskMatch = line.match(/^(\s*[-*+]\s)\[([xX ])\]\s(.+)$/)
    if (taskMatch) {
      const checkStart = lineStart + taskMatch[1].length
      regions.push({
        type: 'task-list',
        from: lineStart,
        to: lineEnd,
        contentFrom: checkStart + 4,
        contentTo: lineEnd,
        meta: {
          checked: taskMatch[2].toLowerCase() === 'x',
          checkFrom: checkStart,
          checkTo: checkStart + 3
        }
      })
    }

    // Inline patterns on this line
    parseInlineRegions(line, lineStart, regions)

    pos = lineEnd + 1
  }

  if (inCodeBlock) {
    const end = Math.max(codeBlockStart, doc.length)
    regions.push({
      type: 'code-block',
      from: codeBlockStart,
      to: end,
      contentFrom: codeBlockStart,
      contentTo: end,
      meta: {
        language: codeBlockLang,
        openingFrom: codeBlockStart,
        openingTo: codeBlockOpeningTo,
        closingFrom: -1,
        closingTo: -1
      }
    })
  }

  return regions
}

/**
 * Parse inline markdown patterns within a single line.
 */
function parseInlineRegions(line, lineStart, regions) {
  // Image: ![alt](url)
  const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g
  let m
  while ((m = imgRe.exec(line)) !== null) {
    regions.push({
      type: 'image',
      from: lineStart + m.index,
      to: lineStart + m.index + m[0].length,
      contentFrom: lineStart + m.index + 2,
      contentTo: lineStart + m.index + 2 + m[1].length,
      meta: { alt: m[1], url: m[2] }
    })
  }

  // Link: [text](url) — but not images
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g
  while ((m = linkRe.exec(line)) !== null) {
    regions.push({
      type: 'link',
      from: lineStart + m.index,
      to: lineStart + m.index + m[0].length,
      contentFrom: lineStart + m.index + 1,
      contentTo: lineStart + m.index + 1 + m[1].length,
      meta: { text: m[1], url: m[2] }
    })
  }

  // Bold: **text** or __text__
  const boldRe = /(\*\*|__)(?!\s)(.+?)(?<!\s)\1/g
  while ((m = boldRe.exec(line)) !== null) {
    regions.push({
      type: 'bold',
      from: lineStart + m.index,
      to: lineStart + m.index + m[0].length,
      contentFrom: lineStart + m.index + 2,
      contentTo: lineStart + m.index + 2 + m[2].length,
      meta: { marker: m[1] }
    })
  }

  // Italic: *text* or _text_ (not bold)
  const italicRe = /(?<!\*|\w)(\*|_)(?!\s|\1)(.+?)(?<!\s)\1(?!\*|\w)/g
  while ((m = italicRe.exec(line)) !== null) {
    // Skip if this is part of a bold marker
    const fullFrom = lineStart + m.index
    const isBold = regions.some(r => r.type === 'bold' && r.from <= fullFrom && r.to >= fullFrom + m[0].length)
    if (isBold) continue
    regions.push({
      type: 'italic',
      from: fullFrom,
      to: fullFrom + m[0].length,
      contentFrom: fullFrom + 1,
      contentTo: fullFrom + 1 + m[2].length,
      meta: { marker: m[1] }
    })
  }

  // Strikethrough: ~~text~~
  const strikeRe = /~~(?!\s)(.+?)(?<!\s)~~/g
  while ((m = strikeRe.exec(line)) !== null) {
    regions.push({
      type: 'strikethrough',
      from: lineStart + m.index,
      to: lineStart + m.index + m[0].length,
      contentFrom: lineStart + m.index + 2,
      contentTo: lineStart + m.index + 2 + m[1].length,
      meta: {}
    })
  }

  // Inline code: `code`
  const codeRe = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g
  while ((m = codeRe.exec(line)) !== null) {
    const markerLen = m[1].length
    regions.push({
      type: 'inline-code',
      from: lineStart + m.index,
      to: lineStart + m.index + m[0].length,
      contentFrom: lineStart + m.index + markerLen,
      contentTo: lineStart + m.index + markerLen + m[2].length,
      meta: { markerLen }
    })
  }
}

/**
 * Return true when any selection range actually touches a parsed region.
 *
 * Fold cursors are a point, so the boundaries of a syntax region are included.
 * Non-empty selections use the same half-open interval rule as document changes.
 * Every region is judged from this one predicate so inline and block decorations
 * cannot diverge during multiple or cross-line selections.
 * @param {MarkdownRegion} region
 * @param {{from: number, to: number, empty?: boolean}[]} selectionRanges
 * @returns {boolean}
 */
export function isRegionActive(region, selectionRanges) {
  if (!region || !Array.isArray(selectionRanges)) return false

  return selectionRanges.some(range => {
    if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') return false
    const from = Math.min(range.from, range.to)
    const to = Math.max(range.from, range.to)
    const empty = typeof range.empty === 'boolean' ? range.empty : from === to

    if (empty) {
      return from >= region.from && from <= region.to
    }
    return from < region.to && to > region.from
  })
}

/**
 * Check if a position falls within any region.
 * @param {MarkdownRegion[]} regions
 * @param {number} pos
 * @returns {MarkdownRegion|null}
 */
export function regionAtPos(regions, pos) {
  return regions.find(r => pos >= r.from && pos <= r.to) || null
}

/**
 * Backwards-compatible wrapper for the single-selection API.
 * @param {MarkdownRegion} region
 * @param {number} from
 * @param {number} [to]
 * @returns {boolean}
 */
export function cursorOnRegion(region, from, to = from) {
  return isRegionActive(region, [{ from, to, empty: from === to }])
}
