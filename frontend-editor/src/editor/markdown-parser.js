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

// 围栏行：至多 3 个空格缩进 + 3 个及以上 ` 或 ~，其余为 info/尾部内容
const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/

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
  let codeBlockChar = ''
  let codeBlockMarkerLen = 0
  let codeBlockLang = ''
  // 记录开闭围栏各自所在行的行首位置，供装饰层精确隐藏围栏
  let codeBlockFences = []

  const pushCodeBlock = (to) => {
    regions.push({
      type: 'code-block',
      from: codeBlockStart,
      to,
      contentFrom: codeBlockStart,
      contentTo: to,
      meta: { language: codeBlockLang, fences: codeBlockFences.slice() }
    })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineStart = pos
    const lineEnd = pos + line.length

    // Code block fences
    const fenceMatch = line.match(FENCE_RE)
    if (fenceMatch) {
      const indent = fenceMatch[1].length
      const marker = fenceMatch[2]
      const rest = fenceMatch[3]

      if (!inCodeBlock) {
        // 反引号围栏的 info 字符串中不允许再出现反引号（CommonMark 约束），
        // 否则该行只是普通文本，不是围栏开启行
        if (!(marker[0] === '`' && rest.includes('`'))) {
          inCodeBlock = true
          codeBlockStart = lineStart
          codeBlockChar = marker[0]
          codeBlockMarkerLen = marker.length
          codeBlockLang = rest.trim()
          codeBlockFences = [lineStart]
          pos = lineEnd + 1
          continue
        }
      } else if (
        marker[0] === codeBlockChar &&
        marker.length >= codeBlockMarkerLen &&
        indent <= 3 &&
        /^[ \t]*$/.test(rest)
      ) {
        // 闭合围栏：标记字符必须与开启围栏一致、长度不短于开启围栏，
        // 且其后只允许空白（带 info 文本的不是闭合围栏）
        codeBlockFences.push(lineStart)
        pushCodeBlock(lineEnd)
        inCodeBlock = false
        codeBlockStart = -1
        codeBlockChar = ''
        codeBlockLang = ''
        codeBlockFences = []
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

  // 文档结束时仍未闭合的围栏：按代码块收口到文档末尾。
  // 这样连续输入（例如刚敲完 ``` ）时结构是确定的，
  // 不会把后续内容“吞掉”导致整片区域同时展开/收起。
  if (inCodeBlock) {
    pushCodeBlock(doc.length)
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

// ---------------------------------------------------------------------------
// 编辑态判定 —— 全应用唯一事实源
//
// 一个区域在任意一次渲染中只会被这里的一套规则判定一次：
//   1. 每个选区（折叠光标或跨行选择都一样）统一展开为它所覆盖的行范围；
//   2. 多个选区的行范围归并为不相交的“编辑态行区间”集合；
//   3. 区域与任一区间相交即处于编辑态（展示语法标记），否则处于渲染态。
// 装饰插件、外部消费者都只能通过这些函数得到判定结果，不允许另写判定逻辑。
// ---------------------------------------------------------------------------

/**
 * 合并若干区间为不相交、按位置排序的区间集合。
 * @param {{from:number,to:number}[]} ranges
 * @returns {{from:number,to:number}[]}
 */
export function mergeRanges(ranges) {
  const sorted = ranges
    .filter(r => r.to >= r.from)
    .map(r => ({ from: r.from, to: r.to }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  const merged = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.from <= last.to) {
      if (r.to > last.to) last.to = r.to
    } else {
      merged.push(r)
    }
  }
  return merged
}

/**
 * 由选区集合计算统一的“编辑态行区间”。
 * 折叠选区取光标所在行；非折叠选区取起点行到终点行（跨行选择自然覆盖中间各行，
 * 与单击定位时只展开当前行的行为一致）。
 *
 * @param {{from:number,to:number}[]} selectionRanges - state.selection.ranges
 * @param {(pos:number)=>{from:number,to:number}} lineAt - doc.lineAt 适配器
 * @returns {{from:number,to:number}[]} 归并后的不相交行区间
 */
export function getActiveLineRanges(selectionRanges, lineAt) {
  return mergeRanges(
    selectionRanges.map(sel => {
      const first = lineAt(sel.from)
      const last = lineAt(sel.to)
      return {
        from: Math.min(first.from, last.from),
        to: Math.max(first.to, last.to)
      }
    })
  )
}

/**
 * 区间相交判定（边界相接算相交，与“光标停在标记紧邻处也能编辑”的体验一致）。
 */
function overlapsRanges(from, to, ranges) {
  for (const r of ranges) {
    if (from <= r.to && r.from <= to) return true
  }
  return false
}

/**
 * 区域是否处于编辑态的唯一判定入口。
 * @param {MarkdownRegion} region
 * @param {{from:number,to:number}[]} activeRanges - getActiveLineRanges 的结果
 * @returns {boolean}
 */
export function isRegionActive(region, activeRanges) {
  return overlapsRanges(region.from, region.to, activeRanges)
}

/**
 * Check if a position falls within any region.
 * @param {MarkdownRegion[]} regions
 * @param {number} pos
 * @returns {MarkdownRegion|null}
 */
export function regionAtPos(regions, pos) {
  return regions.find(r => isRegionActive(r, [{ from: pos, to: pos }])) || null
}

/**
 * Check if a cursor line overlaps with a region.
 * @param {MarkdownRegion} region
 * @param {number} lineFrom
 * @param {number} lineTo
 * @returns {boolean}
 */
export function cursorOnRegion(region, lineFrom, lineTo) {
  return isRegionActive(region, [{ from: lineFrom, to: lineTo }])
}
