import test from 'node:test'
import assert from 'node:assert/strict'
import esbuild from 'esbuild'

const bundle = await esbuild.build({ entryPoints: ['src/callout.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { formatCallout } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

test('callout copies body text and hides the highlight link on its final line', () => {
  const record = { id: '01highlight', source: 'Karen Jobes, Esther', attribution: 'Karen Jobes, Esther', attributionLink: '[[Karen Jobes, Esther]]' }
  assert.equal(formatCallout(record, 'First line\n\nLast line'), '> [!quote] [[Karen Jobes, Esther]]\n> First line\n> \n> Last line [[01highlight|]]')
  assert.equal(formatCallout(record, 'One line').includes('![[01highlight]]'), false)
})

test('plain author attribution works for article highlights', () => {
  const record = { id: '01article', source: 'John Piper, An Article', attribution: 'John Piper', attributionLink: null }
  assert.equal(formatCallout(record, 'Text'), '> [!quote] John Piper\n> Text [[01article|]]')
})
