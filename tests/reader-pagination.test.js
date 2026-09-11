const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const pagination = require('../utils/reader-pagination')

function reader(width = 588, height = 600) {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/read/read.js'), 'utf8'), {
    require: (name) => name.includes('reader-pagination') ? pagination : {},
    Page: (value) => { page = value }, wx: {},
    getApp: () => ({ globalData: { layout: {} } }),
  })
  page.data.isLandscapeReader = true
  page.data.readerLandscapeViewportWidth = width
  page.data.readerLandscapeViewportHeight = height
  return page
}

test('English fills substantially more of the page than the old full-width character budget', () => {
  const page = reader()
  const paragraph = 'The townsfolk refused to believe the news. Then a train crawled into the station. '
  const pages = page.paginateSourceLines([paragraph.repeat(80)])
  const firstPageLength = pages[0].content.map((p) => p.text).join('').length
  // Old budget: 31 full-width characters * 19 lines = 589 characters.
  assert.ok(firstPageLength > 800, `only ${firstPageLength} characters fitted`)
  assert.equal(pages.flatMap((p) => p.content).map((p) => p.text).join(''), paragraph.repeat(80).trim())
})

test('wraps English at word boundaries and preserves Unicode and punctuation', () => {
  const measure = pagination.createTextMeasurer(16)
  for (const text of [
    'The townsfolk refused to believe the news. “What happened?” they asked.',
    '保尔走进车站，看见了许多人。他问：“这是怎么回事？”',
    'A mixed paragraph with 保尔 and René, then an emoji 🙂 at the end.',
    'verylongword'.repeat(60),
  ]) {
    const lines = pagination.wrapTextLines(text, 200, measure)
    assert.equal(lines.join(''), text)
    assert.ok(lines.every((line) => measure(line.trim()) <= 200))
  }
  const words = pagination.wrapTextLines('The townsfolk refused to believe the news.', 160, measure)
  for (let i = 1; i < words.length; i++) {
    assert.ok(/\s$/.test(words[i - 1]) || /^\s/.test(words[i]))
  }
})

test('counts short paragraph spacing and does not force twelve lines into a small viewport', () => {
  for (const [width, height] of [[588, 600], [752, 912], [360, 240], [100, 72]]) {
    const page = reader(width, height)
    const config = page.getPaginationConfig()
    const pages = page.paginateSourceLines(Array.from({ length: 60 }, () => 'Hello world.'))
    const measure = pagination.createTextMeasurer(config.fontSize)
    for (const content of pages.map((p) => p.content)) {
      const used = content.reduce((sum, p, i) => sum
        + pagination.wrapTextLines(p.text, config.textWidth, measure).length
        + (i < content.length - 1 ? config.paragraphGapLines : 0), 0)
      assert.ok(used <= config.maxLinesPerPage + 0.0001, `${width}x${height}: ${used} > ${config.maxLinesPerPage}`)
    }
  }
})

test('preserves spaces between wrapped English source lines', () => {
  const pages = reader().paginateSourceLines(['This is a wrapped', 'English paragraph.'])
  assert.equal(pages[0].content[0].text, 'This is a wrapped English paragraph.')
})

test('starts an oversized word on a new line before breaking it, matching CSS', () => {
  const lines = pagination.wrapTextLines('Hello ' + 'W'.repeat(80), 200, pagination.createTextMeasurer(16))
  assert.equal(lines[0], 'Hello ')
  assert.equal(lines.join(''), 'Hello ' + 'W'.repeat(80))
})
