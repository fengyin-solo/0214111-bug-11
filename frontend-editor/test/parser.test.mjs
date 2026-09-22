import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMarkdownRegions,
  getActiveLineRanges,
  isRegionActive,
  mergeRanges,
  regionAtPos,
  cursorOnRegion
} from '../src/editor/markdown-parser.js'

/** 极简 doc 适配器：把字符串当作按行组织的文档，复刻 CM lineAt 语义 */
function makeDoc(text) {
  const starts = []
  let p = 0
  const lines = text.split('\n')
  for (const line of lines) {
    starts.push(p)
    p += line.length + 1
  }
  const lineAt = (pos) => {
    let idx = starts.findIndex((s, i) => s <= pos && pos < s + lines[i].length + 1)
    if (idx === -1) idx = lines.length - 1 // EOF
    return { number: idx + 1, from: starts[idx], to: starts[idx] + lines[idx].length }
  }
  return { text, lines, starts, lineAt, length: text.length }
}

function activeRangesFor(text, selections) {
  const doc = makeDoc(text)
  return getActiveLineRanges(selections, doc.lineAt)
}

test('未闭合围栏在 EOF 处仍生成 code-block（连续输入场景结构确定）', () => {
  // 模拟刚敲完开启围栏、正在输入代码：后续文本不得被吞掉
  const doc = '# Title\n\n```js\nconst a = 1\n**not bold**\n> not a quote'
  const regions = parseMarkdownRegions(doc)
  const code = regions.filter(r => r.type === 'code-block')
  assert.equal(code.length, 1)
  assert.equal(code[0].from, doc.indexOf('```js'))
  assert.equal(code[0].to, doc.length)
  assert.equal(regions.filter(r => r.type === 'bold').length, 0)
  assert.equal(regions.filter(r => r.type === 'blockquote').length, 0)
})

test('逐字符连续输入围栏时，结构单调收敛，无区域整片闪现', () => {
  // 输入序列： ` -> `` -> ``` -> ```\n -> 代码行...
  // 每个中间态解析结果都必须是确定的：要么无代码块，要么有一个覆盖到 EOF 的代码块
  const sequence = ['`', '``', '```', '```\n', '```\nc', '```\nco', '```\ncode', '```\ncode\n', '```\ncode\n```']
  for (const text of sequence) {
    const regions = parseMarkdownRegions(text)
    const blocks = regions.filter(r => r.type === 'code-block')
    assert.ok(blocks.length <= 1, `unexpected blocks for ${JSON.stringify(text)}`)
    if (blocks.length === 1) {
      // 围栏开启之后到闭合之前，代码块必须一直延伸到 EOF 或闭合行
      assert.equal(blocks[0].from, 0)
      const closed = text.trimEnd().endsWith('```') && text.trim() !== '```'
      assert.equal(blocks[0].to, closed ? text.length : text.length)
    }
  }
})

test('围栏类型必须一致：~~~ 不能闭合 ```', () => {
  const doc = '```js\ncode\n~~~\nstill code'
  const blocks = parseMarkdownRegions(doc).filter(r => r.type === 'code-block')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].to, doc.length, '未正确闭合时应延伸到 EOF')
})

test('带尾随文本的伪闭合围栏不闭合（CommonMark）', () => {
  const doc = '```\ncode\n``` x\nstill code'
  const blocks = parseMarkdownRegions(doc).filter(r => r.type === 'code-block')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].to, doc.length)
})

test('正常闭合围栏：region 恰好覆盖到闭合行，fences 含两行', () => {
  const doc = 'a\n\n~~~\ncode\n~~~'
  const block = parseMarkdownRegions(doc).find(r => r.type === 'code-block')
  assert.ok(block)
  assert.equal(block.from, doc.indexOf('~~~'))
  assert.equal(block.to, doc.length)
  assert.deepEqual(block.meta.fences, [doc.indexOf('~~~'), doc.lastIndexOf('~~~')])
})

test('切换文稿：解析纯函数，相同输入恒有相同输出（撤销/重做/换文档一致）', () => {
  const a = '# H\n\n**bold** and `x`'
  const b = '- [ ] task\n\n![a](https://x/y.png)\n\n> quote'
  for (const doc of [a, b, a, b, a]) {
    const r1 = parseMarkdownRegions(doc)
    const r2 = parseMarkdownRegions(doc)
    assert.deepEqual(r1, r2)
  }
  // 撤销回退：从“已改坏”的未知结构回到正常文档，区域完全恢复
  const edited = '# H\n\n**bold' // 删掉结尾标记
  assert.equal(parseMarkdownRegions(edited).filter(r => r.type === 'bold').length, 0)
  const restored = parseMarkdownRegions(a).filter(r => r.type === 'bold')
  assert.equal(restored.length, 1)
})

test('getActiveLineRanges: 折叠光标只覆盖当前行', () => {
  const text = 'line1\nline2\nline3'
  const doc = makeDoc(text)
  const pos = doc.starts[1] + 2
  const ranges = getActiveLineRanges([{ from: pos, to: pos }], doc.lineAt)
  assert.deepEqual(ranges, [{ from: doc.starts[1], to: doc.starts[1] + 5 }])
})

test('跨行选择覆盖首行到尾行（含中间各行）', () => {
  const text = 'aa\nbb\ncc\ndd'
  const ranges = activeRangesFor(text, [{ from: 1, to: makeDoc(text).starts[2] + 1 }])
  assert.deepEqual(ranges, [{ from: 0, to: makeDoc(text).starts[2] + 2 }])
})

test('多选区：两个不相邻选区产生两个独立区间，同行两个区域被统一判定', () => {
  const text = '**one** mid **two**\nplain'
  const doc = makeDoc(text)
  // 两个光标分别落在同一行的两个 bold 区域里
  const sel1 = { from: text.indexOf('one') + 1, to: text.indexOf('one') + 1 }
  const sel2 = { from: text.indexOf('two') + 1, to: text.indexOf('two') + 1 }
  const ranges = getActiveLineRanges([sel1, sel2], doc.lineAt)
  // 同一行 → 归并成一个区间（一套判定），不会出现同区域两个不同结果
  assert.equal(ranges.length, 1)
  const regions = parseMarkdownRegions(text).filter(r => r.type === 'bold')
  assert.equal(regions.length, 2)
  for (const r of regions) {
    // 同一区域无论问几次结果一致
    assert.equal(isRegionActive(r, ranges), isRegionActive(r, ranges))
    assert.equal(isRegionActive(r, ranges), true)
  }
})

test('多选区落在不同行：各行区域独立判定，无关区域不被联动', () => {
  const text = '**a**\n**b**\n**c**'
  const doc = makeDoc(text)
  const sel = [
    { from: doc.starts[0] + 1, to: doc.starts[0] + 1 }, // 第一行
    { from: doc.starts[2] + 1, to: doc.starts[2] + 1 }  // 第三行
  ]
  const ranges = getActiveLineRanges(sel, doc.lineAt)
  assert.equal(ranges.length, 2)
  const bolds = parseMarkdownRegions(text).filter(r => r.type === 'bold')
  assert.deepEqual(bolds.map(r => isRegionActive(r, ranges)), [true, false, true])
})

test('反向选择（head < anchor）判定相同', () => {
  const text = 'x\n**b**\ny'
  const doc = makeDoc(text)
  const forward = getActiveLineRanges([{ from: doc.starts[1], to: doc.starts[2] }], doc.lineAt)
  const backward = getActiveLineRanges([{ from: doc.starts[2], to: doc.starts[1] }], doc.lineAt)
  assert.deepEqual(forward, backward)
})

test('isRegionActive 边界：相接即相交（停在标记紧邻处可编辑）', () => {
  assert.equal(isRegionActive({ from: 5, to: 9 }, [{ from: 9, to: 9 }]), true)
  assert.equal(isRegionActive({ from: 5, to: 9 }, [{ from: 10, to: 10 }]), false)
})

test('mergeRanges 归并相邻/重叠区间并保持排序', () => {
  assert.deepEqual(
    mergeRanges([{ from: 10, to: 12 }, { from: 0, to: 5 }, { from: 4, to: 8 }, { from: 20, to: 20 }]),
    [{ from: 0, to: 8 }, { from: 10, to: 12 }, { from: 20, to: 20 }]
  )
})

test('未知结构（表格、HTML、未闭合行内标记）不产生错误区域且不影响其他区域', () => {
  const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n\n<div>\n\n**bold**'
  const regions = parseMarkdownRegions(doc)
  // 表格与裸 HTML 当前不支持 → 不生成区域，但 bold 正常识别
  assert.equal(regions.some(r => r.type === 'table'), false)
  assert.equal(regions.filter(r => r.type === 'bold').length, 1)
  // 未闭合的行内标记不会产生区域
  assert.equal(parseMarkdownRegions('text **unclosed').filter(r => r.type === 'bold').length, 0)
})

test('regionAtPos / cursorOnRegion 与统一判定保持一致', () => {
  const text = '**bold**'
  const regions = parseMarkdownRegions(text)
  assert.equal(regionAtPos(regions, 2)?.type, 'bold')
  assert.equal(regionAtPos(regions, 9), null)
  const block = { from: 0, to: 10 }
  assert.equal(cursorOnRegion(block, 5, 20), true)
  assert.equal(cursorOnRegion(block, 11, 15), false)
})

test('task-list / image / hr 等替换型区域的范围不随选区判定错位', () => {
  const doc = '- [x] done\n\n![a](https://e.com/a.png)\n\n---'
  const regions = parseMarkdownRegions(doc)
  const task = regions.find(r => r.type === 'task-list')
  const img = regions.find(r => r.type === 'image')
  const hr = regions.find(r => r.type === 'hr')
  assert.equal(doc.slice(task.meta.checkFrom, task.meta.checkTo), '[x]')
  assert.equal(doc.slice(img.from, img.to), '![a](https://e.com/a.png)')
  assert.equal(doc.slice(hr.from, hr.to), '---')
  // 光标完全不在文档行上时，全部为渲染态；光标逐行扫过时每行恰好激活该行区域
  const doc2 = makeDoc(doc)
  const none = getActiveLineRanges([{ from: 0, to: 0 }], doc2.lineAt)
  assert.equal(isRegionActive(task, none), true, '光标在首行 → task 编辑态')
  const far = getActiveLineRanges([{ from: doc.length, to: doc.length }], () => doc2.lineAt(doc.length))
  assert.equal(isRegionActive(hr, far), true)
  assert.equal(isRegionActive(task, far), false)
})
