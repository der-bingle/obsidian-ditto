import test from 'node:test'
import assert from 'node:assert/strict'
import esbuild from 'esbuild'

const bundle = await esbuild.build({ entryPoints: ['src/display.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const display = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

test('cards never show passage tags, and hide a category tag while its toggle is on', () => {
  const tags = ['bible', 'bible/jas/5/prayer', 'fave', 'illustration/story', 'sin/confession', 'biblical-theology']
  assert.deepEqual(display.displayTags(false, false, tags), ['fave', 'illustration/story', 'sin/confession', 'biblical-theology'])
  assert.deepEqual(display.displayTags(true, false, tags), ['illustration/story', 'sin/confession', 'biblical-theology'])
  assert.deepEqual(display.displayTags(false, true, tags), ['fave', 'sin/confession', 'biblical-theology'])
  assert.deepEqual(display.displayTags(true, true, ['bible/jas/5', 'fave', 'illustration']), [])
})

test('every flat-list card has a source button, grouped cards leave it to the heading, and tags need tags', () => {
  assert.deepEqual(display.cardActions(false, true), ['open-highlight', 'tags', 'copy'])
  assert.deepEqual(display.cardActions(true, true), ['open-highlight', 'open-source', 'tags', 'copy'])
  assert.deepEqual(display.cardActions(true, false), ['open-highlight', 'open-source', 'copy'])
})

test('the source button names the kind of source, and says why when there is no note', () => {
  assert.deepEqual(display.sourceButton({ sourceType: 'book', sourcePath: 'Library/Books/Karen Jobes, Esther.md' }), { icon: 'book-open', label: 'Open book note', available: true })
  assert.deepEqual(display.sourceButton({ sourceType: 'sermon', sourcePath: null }), { icon: 'book-open', label: 'No note for this sermon in the vault', available: false })
  assert.equal(display.sourceButton({ sourceType: null, sourcePath: 'x.md' }).label, 'Open source note')
  assert.equal(display.sourceButton({ sourceType: 'podcast', sourcePath: null }).icon, 'book-open')
})

test('Scripture headings lead with the author and Tags headings with the title', () => {
  const record = { author: 'Dietrich Bonhoeffer', title: 'Life Together' }
  assert.deepEqual(display.groupHeading('scripture', record), { name: 'Dietrich Bonhoeffer', sub: 'Life Together' })
  assert.deepEqual(display.groupHeading('tags', record), { name: 'Life Together', sub: 'Dietrich Bonhoeffer' })
  assert.deepEqual(display.groupHeading('scripture', { author: '', title: 'An Article' }), { name: 'An Article', sub: null })
  assert.deepEqual(display.groupHeading('tags', { author: '', title: '' }), { name: null, sub: null })
})

test('the sort icon pictures the current order', () => {
  assert.equal(display.sortIcon('asc'), 'arrow-up-narrow-wide')
  assert.equal(display.sortIcon('desc'), 'arrow-down-wide-narrow')
  assert.equal(display.sectionLabel('two-ways'), 'Two ways')
})

test('the empty message names the filter that removed the last results', () => {
  const base = { mode: 'tags', passage: 'Tags', tags: ['humility', 'great-commission'], operator: 'and', favorites: false, illustrations: false, matched: 0, inSection: 0 }
  assert.equal(display.emptyMessage(base).title, 'No highlights have all of these tags.')
  assert.equal(display.emptyMessage({ ...base, favorites: true, matched: 4, inSection: 4 }).hint, 'Turn off Favorites to see them.')
  assert.equal(display.emptyMessage({ ...base, mode: 'scripture', passage: 'James 5' }).title, 'No highlights link to James 5.')
})
