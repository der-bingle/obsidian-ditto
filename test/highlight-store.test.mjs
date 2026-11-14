import test from 'node:test'
import assert from 'node:assert/strict'
import esbuild from 'esbuild'

const obsidianStub = {
  name: 'obsidian-stub',
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }))
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export class TFile {}; export class TFolder {}; export const getAllTags = cache => cache.tags || []; export const getFrontMatterInfo = () => ({contentStart: 0})',
      loader: 'js'
    }))
  }
}

const bundle = await esbuild.build({ entryPoints: ['src/highlight-store.ts'], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [obsidianStub] })
const { projectHighlight } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const file = { basename: '01highlight', path: 'Library/Highlights/01highlight.md' }

const project = (highlight, candidate) => projectHighlight({
  metadataCache: {
    getFirstLinkpathDest: () => candidate,
    getFileCache: () => candidate?.cache
  }
}, file, { frontmatter: highlight, tags: ['#marriage'] })

test('an article title does not open a topic, person, sermon, or highlight note as its source', () => {
  const highlight = { title: 'Depression', authors: ['John Piper'], highlighted: '2026-01-01' }
  assert.equal(project(highlight, { path: 'Topics/Depression.md', cache: { frontmatter: {} } }).sourcePath, null)
  assert.equal(project(highlight, { path: 'Library/People/John Piper.md', cache: { frontmatter: {type: 'person'} } }).sourcePath, null)
  assert.equal(project(highlight, { path: 'Library/Highlights/other.md', cache: { frontmatter: {type: 'article', highlighted: '2026-01-01'} } }).sourcePath, null)
})

test('books and identified article notes remain valid source links', () => {
  assert.equal(project({ book: '[[Karen Jobes, Esther]]' }, { path: 'Library/Books/Karen Jobes, Esther.md' }).sourcePath, 'Library/Books/Karen Jobes, Esther.md')
  assert.equal(project({ title: 'An Article' }, { path: 'Library/Articles/An Article.md', cache: { frontmatter: {type: 'article', source: 'https://example.com'} } }).sourcePath, 'Library/Articles/An Article.md')
})

test('a book highlight keeps its author and title apart for group headings', () => {
  const book = { path: 'Library/Books/Karen Jobes, Esther.md', cache: { frontmatter: { title: 'Esther' } } }
  const record = project({ book: '[[Karen Jobes, Esther]]', authors: ['[[Karen Jobes]]'] }, book)
  assert.equal(record.author, 'Karen Jobes')
  assert.equal(record.title, 'Esther')
  const untitled = project({ book: '[[Karen Jobes, Esther]]', authors: ['[[Karen Jobes]]'] }, { path: book.path, cache: { frontmatter: {} } })
  assert.equal(untitled.title, 'Esther')
  assert.equal(project({ title: 'An Article', authors: ['John Piper'] }, null).title, 'An Article')
  assert.equal(record.sourceType, 'book')
  assert.equal(project({ title: 'A Sermon', type: 'Sermon' }, null).sourceType, 'sermon')
  assert.equal(project({ title: 'Untyped' }, null).sourceType, null)
})
