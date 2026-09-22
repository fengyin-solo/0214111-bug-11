import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseMarkdownRegions,
  isRegionActive
} from './markdown-parser.js'

function findRegion(doc, type, index = 0) {
  const matches = parseMarkdownRegions(doc).filter(region => region.type === type)
  assert.ok(matches[index], `Expected ${type} region #${index}`)
  return matches[index]
}

test('a fold cursor activates only the region it touches', () => {
  const doc = 'a **one** b *two*'
  const bold = findRegion(doc, 'bold')
  const italic = findRegion(doc, 'italic')
  const cursor = [{ from: bold.contentFrom, to: bold.contentFrom, empty: true }]

  assert.equal(isRegionActive(bold, cursor), true)
  assert.equal(isRegionActive(italic, cursor), false)
})

test('a non-empty selection activates only intersected inline regions', () => {
  const doc = 'a **one** b *two* c'
  const bold = findRegion(doc, 'bold')
  const italic = findRegion(doc, 'italic')

  assert.equal(isRegionActive(bold, [{ from: bold.to, to: italic.from }]), false)
  assert.equal(isRegionActive(italic, [{ from: bold.to, to: italic.from }]), false)

  const selected = [{ from: bold.contentFrom, to: italic.contentTo }]
  assert.equal(isRegionActive(bold, selected), true)
  assert.equal(isRegionActive(italic, selected), true)
})

test('multiple selections use one active predicate for every matching region', () => {
  const doc = '# Title\n\n**one** and *two* and `code`'
  const heading = findRegion(doc, 'heading')
  const bold = findRegion(doc, 'bold')
  const italic = findRegion(doc, 'italic')
  const code = findRegion(doc, 'inline-code')
  const ranges = [
    { from: bold.contentFrom, to: bold.contentFrom, empty: true },
    { from: code.contentFrom, to: code.contentFrom, empty: true }
  ]

  assert.deepEqual(
    [heading, bold, italic, code].map(region => isRegionActive(region, ranges)),
    [false, true, false, true]
  )
})

test('a cross-line selection activates exactly the spanned block regions', () => {
  const doc = '# First\n\n> quote\n\n# Second'
  const first = findRegion(doc, 'heading', 0)
  const quote = findRegion(doc, 'blockquote')
  const second = findRegion(doc, 'heading', 1)
  const selection = [{ from: first.from, to: quote.to }]

  assert.deepEqual(
    [first, quote, second].map(region => isRegionActive(region, selection)),
    [true, true, false]
  )
})

test('unterminated code fences remain a valid region instead of consuming the document', () => {
  const doc = '```js\nconst answer = 42\n'
  const codeBlock = findRegion(doc, 'code-block')

  assert.equal(codeBlock.to, doc.length)
  assert.equal(codeBlock.meta.openingFrom, 0)
  assert.equal(codeBlock.meta.closingFrom, -1)
  assert.equal(isRegionActive(codeBlock, [{ from: doc.length, to: doc.length, empty: true }]), true)
})

test('code fence closing markers must use the same marker kind', () => {
  const doc = '```\ntilde is not a closing fence: ~~~\n```'
  const codeBlocks = parseMarkdownRegions(doc).filter(region => region.type === 'code-block')

  assert.equal(codeBlocks.length, 1)
  assert.equal(codeBlocks[0].to, doc.length)
})
