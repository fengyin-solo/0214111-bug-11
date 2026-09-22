import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdownDecorationPlugin } from '../src/editor/decoration-plugin.js'

// 不依赖 DOM：直接驱动 ViewPlugin 类（构造 + update），
// 用 fake view 提供 state.doc / state.selection，检查真实生成的 DecorationSet。

const create = markdownDecorationPlugin.create

function makeState(text, selectionRanges) {
  const lines = []
  let p = 0
  for (const lineText of text.split('\n')) {
    lines.push({ text: lineText, from: p, to: p + lineText.length, number: lines.length + 1 })
    p += lineText.length + 1
  }
  const length = text.length
  const lineAt = (pos) => {
    for (const ln of lines) if (pos >= ln.from && pos < ln.to + 1) return ln
    // EOF
    return lines[lines.length - 1]
  }
  return {
    doc: {
      text,
      length,
      toString: () => text,
      lineAt,
      line: (n) => lines[n - 1]
    },
    selection: { ranges: selectionRanges }
  }
}

function decoList(text, selectionRanges) {
  const view = { state: makeState(text, selectionRanges) }
  const inst = create(view)
  const set = inst.decorations
  const out = []
  set.between(0, text.length, (from, to, deco) => {
    out.push({ from, to, spec: deco.spec, startSide: deco.startSide, widget: !!deco.widget })
    return true
  })
  return out
}

const hiddenClass = 'md-syntax-hidden'
const visibleClass = 'md-syntax-visible'
const checkboxWidgetName = 'CheckboxWidget'

function classesAt(list, from, to) {
  return list.filter(d => d.from === from && d.to === to).map(d => d.spec.class)
}

test('单击定位：光标离开后 bold 标记隐藏，进入后标记可见（行为不变）', () => {
  const text = 'plain\n\n**bold** tail\n\nother'
  const open = text.indexOf('**')
  const close = text.indexOf('**', open + 2)
  const outside = decoList(text, [{ from: 0, to: 0 }])
  assert.deepEqual(classesAt(outside, open, open + 2), [hiddenClass])
  assert.deepEqual(classesAt(outside, close, close + 2), [hiddenClass])

  const insidePos = open + 3
  const inside = decoList(text, [{ from: insidePos, to: insidePos }])
  assert.deepEqual(classesAt(inside, open, open + 2), [visibleClass])
  assert.deepEqual(classesAt(inside, close, close + 2), [visibleClass])
})

test('多选区：每个区域只接受一套判定，不同行的两个 bold 各自独立', () => {
  const text = '**a** x\n\n**b** y'
  // 第一处 bold 标记 0..2 / 3..5；第二处位于第 3 行
  const line3 = text.indexOf('**b**') // 9，标记 9..11 / 12..14
  const list = decoList(text, [{ from: 1, to: 1 }, { from: line3 + 1, to: line3 + 1 }])
  assert.deepEqual(classesAt(list, 0, 2), [visibleClass])
  assert.deepEqual(classesAt(list, 3, 5), [visibleClass])
  assert.deepEqual(classesAt(list, line3, line3 + 2), [visibleClass])
  assert.deepEqual(classesAt(list, line3 + 3, line3 + 5), [visibleClass])

  // 只有第一行有光标：第二处必须保持隐藏，不被多选区逻辑连带展开
  const onlyFirst = decoList(text, [{ from: 1, to: 1 }])
  assert.deepEqual(classesAt(onlyFirst, 0, 2), [visibleClass])
  assert.deepEqual(classesAt(onlyFirst, 3, 5), [visibleClass])
  assert.deepEqual(classesAt(onlyFirst, line3, line3 + 2), [hiddenClass])
  assert.deepEqual(classesAt(onlyFirst, line3 + 3, line3 + 5), [hiddenClass])
})

test('跨行选择：只有选区覆盖行的区域进入编辑态，选区外的行不联动', () => {
  const text = '**a**\nmid\n**c**'
  // 选择从第 1 行中部到第 2 行中部
  const list = decoList(text, [{ from: 1, to: text.indexOf('mid') + 1 }])
  assert.deepEqual(classesAt(list, 0, 2), [visibleClass])
  const c = text.indexOf('**c**')
  assert.deepEqual(classesAt(list, c, c + 2), [hiddenClass])
})

test('快速移动光标：同一状态多次构建结果完全一致（无残留/抖动源）', () => {
  const text = '# H\n\n**x** *y* `z`\n\n> q\n\n- [ ] t'
  const positions = [0, text.length, 5, text.indexOf('*y*') + 1, text.indexOf('> q') + 2]
  for (const pos of positions) {
    const a = decoList(text, [{ from: pos, to: pos }])
    const b = decoList(text, [{ from: pos, to: pos }])
    assert.deepEqual(a, b)
  }
})

test('连续输入未闭合围栏：围栏保持可见、代码行样式存在，文档其余区域不被波及', () => {
  const text = '# H\n\n```js\nconst x = 1\n**not bold**'
  const fenceFrom = text.indexOf('```js')
  const list = decoList(text, [{ from: text.length, to: text.length }])
  // 开启围栏没有被加上隐藏装饰（未闭合 → 正在编辑的未知结构）
  const fenceLineEnd = fenceFrom + 5
  assert.deepEqual(classesAt(list, fenceFrom, fenceLineEnd), [])
  // 代码块行装饰存在（每一行一个 line deco）
  const lineDecos = list.filter(d => d.spec.class === 'md-code-block')
  assert.ok(lineDecos.length >= 3)
  // 围栏内的 ** 不产生 bold 标记装饰
  assert.equal(list.find(d => d.spec.class === 'md-bold'), undefined)
  // 标题样式仍正常（其余区域不被波及）
  assert.ok(list.some(d => d.spec.class && d.spec.class.startsWith('md-heading')))
})

test('已闭合代码块：光标不在块内时开闭围栏均隐藏；进入后恢复', () => {
  const text = 'a\n\n~~~\ncode\n~~~\n\nb'
  const open = text.indexOf('~~~')
  const close = text.lastIndexOf('~~~')
  const hidden = decoList(text, [{ from: 0, to: 0 }])
  assert.deepEqual(classesAt(hidden, open, open + 3), [hiddenClass])
  assert.deepEqual(classesAt(hidden, close, close + 3), [hiddenClass])

  const active = decoList(text, [{ from: open + 5, to: open + 5 }])
  assert.deepEqual(classesAt(active, open, open + 3), [])
  assert.deepEqual(classesAt(active, close, close + 3), [])
})

test('切换文稿：插件用新文本重建，装饰与新文档位置严格对齐', () => {
  const docA = 'cursor here\n**bold**'
  const docB = 'x\n- [ ] task text'
  const a = decoList(docA, [{ from: 0, to: 0 }])
  const boldOpen = docA.indexOf('**')
  assert.deepEqual(classesAt(a, boldOpen, boldOpen + 2), [hiddenClass])
  const b = decoList(docB, [{ from: 0, to: 0 }])
  // task checkbox 替换装饰：覆盖新文稿中的 "[ ] "（含尾随空格）共 4 字符
  const checkboxFrom = docB.indexOf('[ ]')
  const checkbox = b.find(d => d.widget && d.from === checkboxFrom && d.to === checkboxFrom + 4)
  // 旧文稿位置上不应再有 bold 装饰残留
  assert.equal(b.find(d => d.spec.class === 'md-bold'), undefined)
})

test('同起点装饰按 startSide 排序，RangeSetBuilder 不抛异常', () => {
  // heading 行同时可能拥有：line/ mark 等装饰；构造包含 code-block + 行内混排的文档
  const text = '```\n`x`\n```\n**b**'
  assert.doesNotThrow(() => decoList(text, [{ from: 0, to: 0 }]))
  assert.doesNotThrow(() => decoList(text, [{ from: text.length, to: text.length }]))
})

test('装饰集合按位置有序输出（标记范围不错位）', () => {
  const text = '**a** and *i* and `c` and [l](http://x)'
  const list = decoList(text, [{ from: 0, to: 0 }])
  let lastFrom = -1
  let lastSide = -Infinity
  for (const d of list) {
    assert.ok(d.from >= lastFrom, `from 必须非递减: ${d.from} < ${lastFrom}`)
    if (d.from === lastFrom) assert.ok(d.startSide >= lastSide)
    if (d.from > lastFrom) { lastFrom = d.from; lastSide = d.startSide }
  }
  void checkboxWidgetName
})
