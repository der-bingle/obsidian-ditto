import test from 'node:test'
import assert from 'node:assert/strict'
import esbuild from 'esbuild'

const bundle = await esbuild.build({ entryPoints: ['src/query.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const query = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

const record = (path, tags, time, source = 'Source') => ({
  id: path, path, tags, highlightedMs: time, source, attribution: source, sourcePath: null, isBook: false, scripturePaths: []
})

test('parent tags match descendants and AND/OR use selected tags', () => {
  const tags = ['bible/jas/5/prayer', 'marriage']
  assert.equal(query.matchesTags(['#bible/jas', 'marriage'], 'and', tags), true)
  assert.equal(query.matchesTags(['bible/jas', 'money'], 'and', tags), false)
  assert.equal(query.matchesTags(['bible/jas', 'money'], 'or', tags), true)
  assert.equal(query.matchesTags([], 'or', tags), false)
  assert.equal(query.matchesTag('bible/ja', tags[0]), false)
})

test('category filters intersect and section filters use the passage', () => {
  const tags = ['fave', 'illustration', 'bible/jas/5/prayer']
  assert.equal(query.matchesCategories(true, true, tags), true)
  assert.equal(query.matchesCategories(true, true, ['fave']), false)
  assert.deepEqual(query.sectionTags(tags, 'Bible/James 5.md'), ['prayer'])
  assert.equal(query.matchesSection('prayer', 'Bible/James 5.md', record('a', tags, 1)), true)
  assert.equal(query.matchesSection('swear', 'Bible/James 5.md', record('a', tags, 1)), false)
})

test('groups sort by count and date order keeps invalid dates last', () => {
  const records = [record('b', [], null, 'Alpha'), record('a', [], 2, 'Beta'), record('c', [], 1, 'Beta')]
  const groups = query.groupHighlights('desc', records)
  assert.deepEqual(groups.map(group => group.source), ['Beta', 'Alpha'])
  assert.deepEqual(groups[0].highlights.map(item => item.path), ['a', 'c'])
  assert.deepEqual(query.sortHighlights('asc', records).map(item => item.path), ['c', 'a', 'b'])
  assert.deepEqual(records.map(item => item.path), ['b', 'a', 'c'])
})

test('tag counts include each parent once per highlight', () => {
  const counts = query.tagCounts([record('a', ['bible/jas/5', 'bible/jas/5/prayer'], 1)])
  assert.equal(counts.find(item => item.tag === 'bible/jas')?.count, 1)
  assert.equal(counts.find(item => item.tag === 'bible/jas/5')?.count, 1)
})
