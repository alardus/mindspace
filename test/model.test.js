import test from 'node:test'
import assert from 'node:assert/strict'
import * as mapModel from '../src/model.js'
import { COLORS, DEFAULT_SIZE, highlightParts, nextMatch, normalizeSearch, searchOrder, PALETTES, descendantsOf, insertTreeEdgeAfter, layoutVerticalGap, nodeInDirection, nodeStyle, normalizeSettings, plural, recolorForPalette, layoutNodes, makeEdge, makeNode, normalizeLibrary, normalizeMap, pluralNodes, relativeTime, shiftNodesBelow, starterMap, toOpml } from '../src/model.js'

const parseMarkdown = mapModel.parseMarkdown ?? (() => ({ title: '', nodes: [], edges: [] }))
const toMarkdown = mapModel.toMarkdown ?? (() => '')
const blockPreview = mapModel.blockPreview ?? ((text) => text)
const pointRectDistance = mapModel.pointRectDistance ?? (() => Infinity)
const branchCurveBend = mapModel.branchCurveBend ?? (() => 60)
const allowsAttachTarget = mapModel.allowsAttachTarget ?? (() => true)
const anchorNodeResize = mapModel.anchorNodeResize ?? (() => {})
const beginNodeEdit = mapModel.beginNodeEdit ?? ((node) => ({ id: node.id, x: node.position.x, width: null }))
const restoreNodeEdit = mapModel.restoreNodeEdit ?? (() => null)
const persistedNodePosition = mapModel.persistedNodePosition ?? ((node) => node.position)
const nextSiblingX = mapModel.nextSiblingX ?? ((sibling) => sibling.position.x)

const image = {
  assetId: 'asset-1',
  name: 'diagram.png',
  mime: 'image/png',
  naturalWidth: 1200,
  naturalHeight: 800,
}

test('block preview hides text after 1000 characters without discarding it', () => {
  const long = `${'a'.repeat(1000)}b`

  assert.equal(blockPreview('a'.repeat(1000)), 'a'.repeat(1000))
  assert.equal(blockPreview('🙂'.repeat(1000)), '🙂'.repeat(1000))
  assert.equal(blockPreview(long), `${'a'.repeat(1000)}...`)
  assert.equal(normalizeMap({ version: 2, nodes: [{ data: { label: long } }], edges: [] }).nodes[0].data.label, long)
})

test('block text separates web links from surrounding punctuation', () => {
  assert.deepEqual(mapModel.linkParts?.('Docs: https://example.com/guide, mirror: http://example.org.'), [
    { text: 'Docs: ' },
    { text: 'https://example.com/guide', href: 'https://example.com/guide' },
    { text: ', mirror: ' },
    { text: 'http://example.org', href: 'http://example.org' },
    { text: '.' },
  ])
})

test('attachment proximity follows the cursor beside any part of a block', () => {
  const target = { x: 300, y: 100, width: 80, height: 30 }

  assert.equal(pointRectDistance({ x: 250, y: 100 }, target), 50)
  assert.equal(pointRectDistance({ x: 250, y: 115 }, target), 50)
  assert.equal(pointRectDistance({ x: 250, y: 130 }, target), 50)
  assert.equal(pointRectDistance({ x: 320, y: 115 }, target), 0)
})

test('branch curves cannot bend back across a short or reversed gap', () => {
  assert.equal(branchCurveBend(0, 200, 1), 60)
  assert.equal(branchCurveBend(0, 80, 1), 40)
  assert.equal(branchCurveBend(100, 20, -1), -40)
  assert.equal(branchCurveBend(100, 120, -1), 0)
})

test('a resized branch grows away from its incoming connector', () => {
  const left = makeNode('Left', { x: 100, y: 20 }, { side: 'left' })
  const right = makeNode('Right', { x: 300, y: 20 }, { side: 'right' })

  anchorNodeResize(left, 80, 240)
  anchorNodeResize(right, 80, 240)

  assert.equal(left.position.x, -60)
  assert.equal(left.position.x + 240, 180)
  assert.equal(right.position.x, 300)

  anchorNodeResize(left, 240, 80)
  assert.equal(left.position.x, 100)
  assert.equal(left.position.x + 80, 180)

  const unmeasured = makeNode('New', { x: 50, y: 20 }, { side: 'left' })
  anchorNodeResize(unmeasured, undefined, 240)
  assert.equal(unmeasured.position.x, 50)
})

test('node editing keeps temporary geometry out of persistence and restores the resize anchor', () => {
  const node = makeNode('New', { x: 50, y: 20 }, { side: 'left' })
  const anchor = beginNodeEdit(node)

  assert.equal(anchor.width, DEFAULT_SIZE.width)
  anchorNodeResize(node, anchor.width, 240)
  assert.equal(node.position.x + 240, 50 + DEFAULT_SIZE.width)
  assert.deepEqual(persistedNodePosition(node, anchor, false), { x: 50, y: 20 })

  const baseline = restoreNodeEdit(node, anchor)
  anchorNodeResize(node, baseline, 80)
  assert.equal(node.position.x + 80, 50 + DEFAULT_SIZE.width)
  assert.deepEqual(persistedNodePosition(node, null, false), node.position)

  node.position.x = 25
  assert.deepEqual(persistedNodePosition(node, anchor, true), { x: 25, y: 20 })
})

test('a new manual sibling shares the incoming connector of a left branch', () => {
  const left = makeNode('Left', { x: 100, y: 20 }, { side: 'left' })
  const right = makeNode('Right', { x: 300, y: 20 }, { side: 'right' })

  assert.equal(nextSiblingX(left, 80), 0)
  assert.equal(nextSiblingX(right, 80), 300)
})

test('an attached branch changes parent only when dropped on the new parent', () => {
  assert.equal(allowsAttachTarget([undefined], 'new-parent', false), true)
  assert.equal(allowsAttachTarget(['current-parent'], 'current-parent', false), true)
  assert.equal(allowsAttachTarget(['current-parent'], 'new-parent', false), false)
  assert.equal(allowsAttachTarget(['current-parent'], 'new-parent', true), true)
})

test('image-only nodes survive a version 3 round-trip', () => {
  const map = normalizeMap({
    version: 3,
    nodes: [makeNode('', {}, { id: 'image', image })],
    edges: [],
  })

  assert.equal(map.version, 3)
  assert.deepEqual(map.nodes[0].data.image, image)
  assert.equal(map.needsLayout, undefined)
  assert.deepEqual([...mapModel.referencedAssetIds?.(map) ?? []], ['asset-1'])
})

test('image references are validated without changing text nodes', () => {
  const map = normalizeMap({
    version: 3,
    nodes: [
      { id: 'valid', data: { label: 'Diagram', image } },
      { id: 'invalid', data: { label: 'Text stays', image: { ...image, mime: 'image/svg+xml' } } },
    ],
    edges: [],
  })

  assert.deepEqual(map.nodes[0].data.image, image)
  assert.equal(map.nodes[1].data.image, undefined)
  assert.equal(map.nodes[1].data.label, 'Text stays')
})

test('empty version 3 blocks are rejected while legacy labels still migrate', () => {
  assert.throws(() => normalizeMap({ version: 3, nodes: [{ id: 'empty', data: { label: '' } }], edges: [] }), /empty block/i)
  const legacy = normalizeMap({ version: 2, nodes: [{ id: 'legacy', data: {} }], edges: [] })
  assert.equal(legacy.nodes[0].data.label, 'Idea 1')
})

test('merge image node into text while preserving its children', () => {
  const parent = makeNode('Parent', {}, { id: 'parent', root: true })
  const source = makeNode('', {}, { id: 'source', image })
  const target = makeNode('Target', {}, { id: 'target', root: true })
  const first = makeNode('First', {}, { id: 'first' })
  const second = makeNode('Second', {}, { id: 'second' })
  const unrelated = makeNode('Unrelated', {}, { id: 'unrelated' })
  const nodes = [parent, source, target, first, second, unrelated]
  const edges = [
    makeEdge('parent', 'source', 'incoming'),
    makeEdge('source', 'first', 'first-edge'),
    makeEdge('source', 'second', 'second-edge'),
    makeEdge('parent', 'unrelated', 'unrelated-edge'),
  ]

  const result = mapModel.mergeImageNode?.(nodes, edges, 'source', 'target') ?? { error: 'missing' }

  assert.equal(result.error, null)
  assert.deepEqual(result.nodes.find((node) => node.id === 'target').data.image, image)
  assert.equal(result.nodes.some((node) => node.id === 'source'), false)
  assert.deepEqual(result.edges.map(({ id, source: from, target: to }) => [id, from, to]), [
    ['first-edge', 'target', 'first'],
    ['second-edge', 'target', 'second'],
    ['unrelated-edge', 'parent', 'unrelated'],
  ])
  assert.equal(nodes.length, 6)
  assert.equal(edges.length, 4)
})

test('merge image rejects occupied, cyclic and invalid sources', () => {
  const source = makeNode('', {}, { id: 'source', image })
  const occupied = makeNode('Occupied', {}, { id: 'occupied', image: { ...image, assetId: 'asset-2' } })
  const child = makeNode('Child', {}, { id: 'child' })
  const plain = makeNode('Plain', {}, { id: 'plain' })
  const nodes = [source, occupied, child, plain]
  const edges = [makeEdge('source', 'child')]

  assert.equal(mapModel.mergeImageNode?.(nodes, edges, 'source', 'occupied')?.error, 'target-has-image')
  assert.equal(mapModel.mergeImageNode?.(nodes, edges, 'source', 'child')?.error, 'cycle')
  assert.equal(mapModel.mergeImageNode?.(nodes, edges, 'plain', 'child')?.error, 'invalid-source')
})

test('image outline keeps descendants in OPML', () => {
  const map = normalizeMap({
    version: 3,
    title: 'Pictures',
    nodes: [
      { id: 'image', data: { label: '', image } },
      { id: 'child', data: { label: 'Explanation' } },
    ],
    edges: [makeEdge('image', 'child')],
  })

  assert.match(toOpml(map), /<outline text="\[Image\]">\n\s+<outline text="Explanation"\/>/)
})

test('tree helpers keep descendants and layout predictable', () => {
  const root = makeNode('root', {}, { id: 'root', root: true })
  const child = makeNode('child', {}, { id: 'child' })
  const leaf = makeNode('leaf', {}, { id: 'leaf' })
  const edges = [makeEdge('root', 'child'), makeEdge('child', 'leaf')]

  assert.deepEqual([...descendantsOf('root', edges)], ['child', 'leaf'])
  const laidOut = layoutNodes([root, child, leaf], edges)
  assert.ok(laidOut.find((node) => node.id === 'child').position.x > laidOut[0].position.x)
})

test('a self-contained root branch can move as one visual group', () => {
  const root = makeNode('root', {}, { id: 'root', root: true })
  const child = makeNode('child', {}, { id: 'child' })
  const leaf = makeNode('leaf', {}, { id: 'leaf' })
  const other = makeNode('other', {}, { id: 'other', root: true })
  const edges = [makeEdge('root', 'child', 'root-child'), makeEdge('child', 'leaf', 'child-leaf')]

  assert.deepEqual(mapModel.rigidRootBranch?.(root, [root], edges), {
    nodeIds: ['root', 'child', 'leaf'],
    edgeIds: ['root-child', 'child-leaf'],
  })
  assert.equal(mapModel.rigidRootBranch?.(child, [child], edges), null)
  // A link is drawn from block positions, which a rigid drag does not touch — even a link inside the branch.
  assert.equal(mapModel.rigidRootBranch?.(root, [root], edges, [{ from: 'leaf', to: other.id }]), null)
  assert.equal(mapModel.rigidRootBranch?.(root, [root], edges, [{ from: 'child', to: 'leaf' }]), null)
  assert.notEqual(mapModel.rigidRootBranch?.(root, [root], edges, [{ from: other.id, to: 'elsewhere' }]), null)
})

test('reparents every top-level selected branch without flattening selected descendants', () => {
  const target = makeNode('target', {}, { id: 'target', root: true })
  const first = makeNode('first', {}, { id: 'first', root: true })
  const firstChild = makeNode('first child', {}, { id: 'first-child' })
  const oldParent = makeNode('old parent', {}, { id: 'old-parent', root: true })
  const second = makeNode('second', {}, { id: 'second' })
  const secondChild = makeNode('second child', {}, { id: 'second-child' })
  const nodes = [target, first, firstChild, oldParent, second, secondChild]
  const edges = [
    makeEdge('first', 'first-child', 'first-child-edge'),
    makeEdge('old-parent', 'second', 'old-second-edge'),
    makeEdge('second', 'second-child', 'second-child-edge'),
  ]

  const result = mapModel.reparentBranches?.(nodes, edges, ['first', 'first-child', 'second'], 'target')
    ?? { error: 'missing', nodes: [], edges: [], rootIds: [] }

  assert.equal(result.error, null)
  assert.deepEqual(result.rootIds, ['first', 'second'])
  assert.equal(result.nodes.find((node) => node.id === 'first').data.root, false)
  assert.equal(first.data.root, true)
  assert.deepEqual(result.edges.map(({ source, target: child }) => [source, child]), [
    ['first', 'first-child'],
    ['second', 'second-child'],
    ['target', 'first'],
    ['target', 'second'],
  ])
  assert.deepEqual(edges.map(({ source, target: child }) => [source, child]), [
    ['first', 'first-child'],
    ['old-parent', 'second'],
    ['second', 'second-child'],
  ])
})

test('arrow navigation follows visible node positions', () => {
  const current = makeNode('current', { x: 100, y: 100 }, { id: 'current' })
  const right = makeNode('right', { x: 300, y: 110 }, { id: 'right' })
  const lowerRight = makeNode('lower right', { x: 220, y: 300 }, { id: 'lower-right' })
  const hidden = makeNode('hidden', { x: 110, y: 180 }, { id: 'hidden' })
  hidden.hidden = true
  const nodes = [current, right, lowerRight, hidden]

  assert.equal(nodeInDirection(nodes, current.id, 'right').id, right.id)
  assert.equal(nodeInDirection(nodes, current.id, 'down').id, lowerRight.id)
  assert.equal(nodeInDirection(nodes, current.id, 'left'), null)
})

test('a sibling edge is inserted immediately after the current sibling', () => {
  const edges = [
    makeEdge('root', 'first', 'edge-first'),
    makeEdge('root', 'last', 'edge-last'),
  ]
  insertTreeEdgeAfter(edges, makeEdge('root', 'middle', 'edge-middle'), 'first')

  assert.deepEqual(edges.map((edge) => edge.target), ['first', 'middle', 'last'])
  const nodes = ['root', 'first', 'middle', 'last']
    .map((id) => makeNode(id, {}, { id, root: id === 'root' }))
  const laidOut = layoutNodes(nodes, edges, () => null, { layout: 'tree' })
  assert.ok(laidOut[1].position.y < laidOut[2].position.y)
  assert.ok(laidOut[2].position.y < laidOut[3].position.y)
})

test('manual insertion opens vertical space without moving the current branch', () => {
  const current = makeNode('current', { x: 100, y: 100 }, { id: 'current' })
  const child = makeNode('child', { x: 300, y: 130 }, { id: 'child' })
  const next = makeNode('next', { x: 100, y: 180 }, { id: 'next' })
  const otherBranch = makeNode('other', { x: -200, y: 200 }, { id: 'other' })
  const gap = layoutVerticalGap({ density: 'normal' })

  shiftNodesBelow([current, child, next, otherBranch], 160, 30 + gap, new Set(['current', 'child']))

  assert.equal(current.position.y, 100)
  assert.equal(child.position.y, 130)
  assert.equal(next.position.y, 228)
  assert.equal(otherBranch.position.y, 248)
})

test('loaded maps are validated and cleaned', () => {
  assert.throws(() => normalizeMap({}), /Mindspace/)
  const map = normalizeMap({
    title: 'x',
    nodes: [{ id: 'a', position: { x: 1, y: 2 }, data: { label: 'A' } }],
    edges: [{ id: 'broken', source: 'a', target: 'missing' }],
  })
  assert.equal(map.nodes[0].data.root, true)
  assert.equal(map.edges.length, 0)
})

test('library keeps valid documents and active selection', () => {
  const map = { nodes: [{ id: 'node', data: { label: 'Map' } }], edges: [] }
  const library = normalizeLibrary({
    activeId: 'second',
    documents: [
      { id: 'first', map },
      { id: 'broken', map: {} },
      { id: 'second', map: { ...map, title: 'Second' } },
    ],
  })

  assert.equal(library.activeId, 'second')
  assert.deepEqual(library.documents.map((document) => document.id), ['first', 'second'])
  assert.throws(() => normalizeLibrary({ documents: [] }), /no local maps/i)
})

test('maps can have several top-level nodes', () => {
  const map = normalizeMap({
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'b', position: { x: 0, y: 100 }, data: { label: 'B' } },
      { id: 'child', position: { x: 100, y: 0 }, data: { label: 'Child', root: true } },
    ],
    edges: [makeEdge('a', 'child')],
  })

  assert.deepEqual(map.nodes.filter((node) => node.data.root).map((node) => node.id), ['a', 'b'])
})

test('layout balances root branches on both sides', () => {
  const root = makeNode('Root', {}, { id: 'root', root: true })
  const children = ['a', 'b', 'c', 'd'].map((id) => makeNode(id, {}, { id }))
  const edges = children.map((node) => makeEdge(root.id, node.id))
  const laidOut = layoutNodes([root, ...children], edges)
  const rootX = laidOut.find((node) => node.id === root.id).position.x

  assert.ok(laidOut.some((node) => node.position.x < rootX))
  assert.ok(laidOut.some((node) => node.position.x > rootX))
  assert.deepEqual(new Set(edges.map((edge) => edge.sourceHandle)), new Set(['source-left', 'source-right']))
})

test('layout packs several large trees instead of one tall column', () => {
  const nodes = []
  const edges = []
  for (let rootIndex = 0; rootIndex < 6; rootIndex++) {
    const root = makeNode(`Root ${rootIndex}`, {}, { id: `root-${rootIndex}`, root: true })
    nodes.push(root)
    for (let childIndex = 0; childIndex < 12; childIndex++) {
      const child = makeNode(`Child ${childIndex}`, {}, { id: `child-${rootIndex}-${childIndex}` })
      nodes.push(child)
      edges.push(makeEdge(root.id, child.id))
    }
  }

  const laidOut = layoutNodes(nodes, edges)
  const width = Math.max(...laidOut.map((node) => node.position.x)) - Math.min(...laidOut.map((node) => node.position.x))
  const height = Math.max(...laidOut.map((node) => node.position.y)) - Math.min(...laidOut.map((node) => node.position.y))
  assert.ok(width / height > 0.7 && width / height < 2.5)
})

test('maps export to OPML as nested outlines', () => {
  const map = normalizeMap({
    title: 'A & B',
    nodes: [
      { id: 'root', data: { label: 'Root <1>' } },
      { id: 'child', data: { label: 'Child' } },
      { id: 'other', data: { label: 'Other' } },
    ],
    edges: [makeEdge('root', 'child')],
    links: [{ from: 'child', to: 'other', label: 'see <also>' }],
  })
  map.nodes[1].data.note = '7.90 € / мес'
  const opml = toOpml(map)
  assert.match(opml, /<outline text="Child" _note="7.90 € \/ мес"\/>/)
  assert.match(opml, /<title>A &#38; B<\/title>/)
  assert.match(opml, /<outline text="Root &#60;1&#62;">\n\s+<outline text="Child"[^>]*\/>\n\s+<\/outline>/)
  assert.match(opml, /<outline text="Other"\/>/)
  assert.match(opml, /<outline text="Links" _links="true">\n\s+<outline text="Child → Other \(“see &#60;also&#62;”\)"\/>\n\s+<\/outline>\n\s+<\/body>/)
})

test('Markdown headings and indented lists become branches', () => {
  const map = parseMarkdown(`# Product plan

## Launch
- Prepare
  Due Friday
  - Review
1. Publish
### Follow-up
- Measure
`, 'notes')
  const labels = new Map(map.nodes.map((node) => [node.id, node.data.label]))

  assert.equal(map.title, 'Product plan')
  assert.deepEqual(map.nodes.map((node) => node.data.label), ['Launch', 'Prepare', 'Review', 'Publish', 'Follow-up', 'Measure'])
  assert.equal(map.nodes.find((node) => node.data.label === 'Prepare').data.note, 'Due Friday')
  assert.deepEqual(map.edges.map((edge) => [labels.get(edge.source), labels.get(edge.target)]), [
    ['Launch', 'Prepare'],
    ['Prepare', 'Review'],
    ['Launch', 'Publish'],
    ['Launch', 'Follow-up'],
    ['Follow-up', 'Measure'],
  ])
})

test('Markdown without an H1 uses the supplied file title', () => {
  const map = parseMarkdown(`## Decisions
- Ship
`, 'meeting-notes')

  assert.equal(map.title, 'meeting-notes')
  assert.deepEqual(map.nodes.map((node) => node.data.label), ['Decisions', 'Ship'])
})

test('maps export to Markdown without image data', () => {
  const map = normalizeMap({
    version: 3,
    title: 'A & B',
    nodes: [
      { id: 'root', data: { label: 'Project', note: 'Q4' } },
      { id: 'image', data: { label: '', image } },
      { id: 'other', data: { label: 'Other' } },
    ],
    edges: [makeEdge('root', 'image')],
    links: [{ from: 'image', to: 'other', arrows: 'both' }, { from: 'other', to: 'root', label: 'blocks' }],
  })

  assert.equal(toMarkdown(map), `# A & B

- Project
  > Q4
  - [Image]
- Other

Links:

\`\`\`
[Image] ↔ Other
Other → Project (“blocks”)
\`\`\`
`)
  // The fenced list is skipped on the way back in.
  assert.deepEqual(parseMarkdown(toMarkdown(map)).nodes.map((node) => node.data.label), ['Project', '[Image]', 'Other'])
})

test('Markdown round-trip preserves notes that look like structure', () => {
  const notes = ['# status', '- detail', '* detail', '+ detail', '1. step', '2) step', '```js', '~~~', '\\# literal', '1\\. literal', '> quote']
  const map = normalizeMap({
    title: 'Notes',
    nodes: notes.map((note, index) => ({ id: `node-${index}`, data: { label: `Node ${index + 1}`, note } })),
    edges: [],
  })

  const imported = parseMarkdown(toMarkdown(map))

  assert.deepEqual(imported.nodes.map((node) => node.data.label), [
    'Node 1', 'Node 2', 'Node 3', 'Node 4', 'Node 5', 'Node 6', 'Node 7', 'Node 8', 'Node 9', 'Node 10', 'Node 11',
  ])
  assert.deepEqual(imported.nodes.map((node) => node.data.note), notes)
  assert.equal(imported.edges.length, 0)
})

test('Markdown ignores headings and lists inside fenced code blocks', () => {
  const map = parseMarkdown([
    '# Notes',
    '## Real',
    '```md',
    '### Fake heading',
    '- Fake item',
    '```',
    '~~~',
    '- Also fake',
    '~~~',
    '- Actual',
  ].join('\n'))
  const labels = new Map(map.nodes.map((node) => [node.id, node.data.label]))

  assert.deepEqual(map.nodes.map((node) => node.data.label), ['Real', 'Actual'])
  assert.deepEqual(map.edges.map((edge) => [labels.get(edge.source), labels.get(edge.target)]), [['Real', 'Actual']])
})

test('Markdown continuation text returns to its parent after a nested item', () => {
  const map = parseMarkdown(`- Parent
  first note
  - Child
    child note
  second parent note
`)

  assert.deepEqual(map.nodes.map((node) => [node.data.label, node.data.note]), [
    ['Parent', 'first note second parent note'],
    ['Child', 'child note'],
  ])
})

test('Markdown accepts a BOM before its H1 title', () => {
  const map = parseMarkdown('\uFEFF# Notes\n\n- First', 'filename')

  assert.equal(map.title, 'Notes')
  assert.deepEqual(map.nodes.map((node) => node.data.label), ['First'])
})

test('document meta is formatted in English', () => {
  assert.equal(pluralNodes(1), '1 node')
  assert.equal(pluralNodes(24), '24 nodes')
  assert.equal(pluralNodes(12), '12 nodes')
  assert.equal(pluralNodes(58), '58 nodes')
  const now = new Date(2026, 9, 2, 12).getTime()
  assert.equal(relativeTime(now - 10_000, now), 'just now')
  assert.equal(relativeTime(now - 86_400_000, now), 'yesterday')
  assert.equal(relativeTime(now - 3 * 86_400_000, now), '3 days ago')
  assert.equal(relativeTime(undefined, now), '')
})

test('nodes keep an optional note and migrate legacy colors', () => {
  const map = normalizeMap({
    nodes: [
      { id: 'a', data: { label: 'Spotify', note: '7.90 € / мес · DSK Leva', color: '#DDEFE7' } },
      { id: 'b', data: { label: 'Plain', color: '#123456' } },
    ],
    edges: [makeEdge('a', 'b')],
  })
  assert.equal(map.nodes[0].data.note, '7.90 € / мес · DSK Leva')
  assert.equal(map.nodes[0].data.label, 'Spotify')
  assert.equal(map.nodes[0].data.color, COLORS[1])
  assert.equal(map.nodes[1].data.note, '')
  assert.equal(map.nodes[1].data.color, COLORS[0])
  assert.equal(map.edges[0].type, 'branch')
  assert.equal(map.edges[0].style.strokeWidth, 2)
})

test('layout uses measured node sizes so wide nodes never overlap', () => {
  const root = makeNode('Root', {}, { id: 'root', root: true })
  const child = makeNode('Child', {}, { id: 'child' })
  const leaf = makeNode('Leaf', {}, { id: 'leaf' })
  const edges = [makeEdge('root', 'child'), makeEdge('child', 'leaf')]
  const sizes = { root: { width: 240, height: 56 }, child: { width: 280, height: 47 }, leaf: { width: 160, height: 26 } }
  const laidOut = layoutNodes([root, child, leaf], edges, (id) => sizes[id])
  const at = (id) => laidOut.find((node) => node.id === id).position
  assert.equal(at('child').x - (at('root').x + 240), 100)
  assert.equal(at('leaf').x - (at('child').x + 280), 100)
})

test('map settings are validated with defaults', () => {
  assert.deepEqual(normalizeSettings(), { layout: 'both', palette: 'bright', lines: 'smooth', density: 'normal' })
  assert.deepEqual(normalizeSettings({ layout: 'tree', palette: 'nope', density: 'loose' }), { layout: 'tree', palette: 'bright', lines: 'smooth', density: 'loose' })
  const map = normalizeMap({ nodes: [{ id: 'a', data: { label: 'A' } }], edges: [], settings: { lines: 'straight' } })
  assert.equal(map.settings.lines, 'straight')
})

test('node style defaults by role and palettes recolor only automatic colors', () => {
  assert.equal(nodeStyle({ root: true }), 'card')
  assert.equal(nodeStyle({ root: false }), 'line')
  assert.equal(nodeStyle({ root: true, style: 'text' }), 'text')
  const auto = makeNode('auto', {}, { color: PALETTES.bright.colors[2] })
  const manual = makeNode('manual', {}, { color: PALETTES.bright.colors[3], manualColor: true })
  recolorForPalette([auto, manual], 'bright', 'calm')
  assert.equal(auto.data.color, PALETTES.calm.colors[2])
  assert.equal(manual.data.color, PALETTES.bright.colors[3])
  assert.equal(plural(21, 'topic', 'topics'), '21 topics')
})

test('layout modes: right puts every branch right, tree indents children below', () => {
  const root = makeNode('Root', {}, { id: 'root', root: true })
  const kids = ['a', 'b', 'c', 'd'].map((id) => makeNode(id, {}, { id }))
  const leaf = makeNode('leaf', {}, { id: 'leaf' })
  const edges = [...kids.map((node) => makeEdge('root', node.id)), makeEdge('a', 'leaf')]
  const right = layoutNodes([root, ...kids, leaf], edges, undefined, { layout: 'right' })
  assert.ok(right.filter((node) => !node.data.root).every((node) => node.data.side === 'right'))
  const tree = layoutNodes([root, ...kids, leaf], edges, undefined, { layout: 'tree' })
  const at = (id) => tree.find((node) => node.id === id).position
  assert.ok(at('a').y > at('root').y && at('leaf').y > at('a').y && at('b').y > at('leaf').y)
  assert.equal(at('leaf').x - at('a').x, 36)
  assert.ok(edges.every((edge) => edge.sourceHandle === 'source-tree'))
})

test('density scales vertical spacing', () => {
  const root = makeNode('Root', {}, { id: 'root', root: true })
  const kids = ['a', 'b'].map((id) => makeNode(id, {}, { id }))
  const edges = kids.map((node) => makeEdge('root', node.id))
  const gap = (density) => {
    const laid = layoutNodes([root, ...kids], edges, undefined, { layout: 'right', density })
    return laid.find((node) => node.id === 'b').position.y - laid.find((node) => node.id === 'a').position.y
  }
  assert.ok(gap('compact') < gap('normal') && gap('normal') < gap('loose'))
})

test('starter map is an English tour that survives a save round-trip', () => {
  const map = starterMap()
  assert.equal(map.title, 'Welcome to Mindspace')
  assert.equal(map.nodes.filter((node) => node.data.root).length, 1)
  assert.ok(map.nodes.every((node) => !/[а-яё]/i.test(`${node.data.label} ${node.data.note}`)))
  assert.ok(map.nodes.some((node) => node.data.collapsed))
  assert.deepEqual(new Set(map.nodes.map((node) => nodeStyle(node.data))), new Set(['card', 'line', 'text']))
  const reopened = normalizeMap(JSON.parse(JSON.stringify(map)))
  assert.equal(reopened.nodes.length, map.nodes.length)
  assert.equal(reopened.edges.length, map.edges.length)
})

test('map search order, wrap-around and highlighting', () => {
  const lower = makeNode('Ёлка', { x: 0, y: 300 }, { id: 'lower', root: true })
  const upper = makeNode('upper', { x: 0, y: 0 }, { id: 'upper', root: true })
  const bottomKid = makeNode('елка', { x: 200, y: 50 }, { id: 'bottom-kid' })
  const topKid = makeNode('kid', { x: 200, y: -50 }, { id: 'top-kid', note: 'ЕЛКА' })
  const edges = [makeEdge('upper', 'bottom-kid'), makeEdge('upper', 'top-kid')]
  const order = searchOrder([lower, upper, bottomKid, topKid], edges)
  assert.deepEqual(order, ['upper', 'top-kid', 'bottom-kid', 'lower'])

  assert.equal(normalizeSearch('ЁЛКА'), 'елка')
  const matches = ['top-kid', 'bottom-kid', 'lower']
  assert.equal(nextMatch(order, matches, 'upper'), 'top-kid')
  assert.equal(nextMatch(order, matches, 'top-kid'), 'bottom-kid')
  assert.equal(nextMatch(order, matches, 'lower'), 'top-kid')
  assert.equal(nextMatch(order, matches, null), 'top-kid')
  assert.equal(nextMatch(order, [], 'upper'), null)

  assert.deepEqual(highlightParts('Ёлка и ёлка', 'елка'), [
    { text: 'Ёлка', match: true }, { text: ' и ', match: false }, { text: 'ёлка', match: true },
  ])
  assert.equal(highlightParts('aaa', 'a').length, 3)
  assert.ok(highlightParts('abc', 'b').every((part) => part.text))
})

test('smart guides snap a block center only inside the threshold', () => {
  const target = { x: 100, y: 0, width: 20, height: 20 }
  const snapped = mapModel.snapNode?.({ x: 94, y: 80, width: 20, height: 20 }, [target], 8, 400)
  const released = mapModel.snapNode?.({ x: 90, y: 80, width: 20, height: 20 }, [target], 8, 400)

  assert.equal(snapped?.x, 100)
  assert.deepEqual(snapped?.guides, [{ x1: 110, y1: 0, x2: 110, y2: 100 }])
  assert.equal(released?.x, 90)
  assert.deepEqual(released?.guides, [])
})

test('equal horizontal gaps survive a zoomed-in search radius', () => {
  const result = mapModel.snapNode?.(
    { x: 563, y: 0, width: 180, height: 30 },
    [{ x: 0, y: 0, width: 180, height: 30 }, { x: 280, y: 0, width: 180, height: 30 }],
    8,
    200,
  )

  assert.equal(result?.x, 560)
  assert.deepEqual(result?.guides.slice(0, 2), [
    { x1: 230, y1: 7, x2: 230, y2: 23 },
    { x1: 510, y1: 7, x2: 510, y2: 23 },
  ])
})

test('equal vertical gaps use horizontal markers', () => {
  const result = mapModel.snapNode?.(
    { x: 0, y: 83, width: 20, height: 20 },
    [{ x: 0, y: 0, width: 20, height: 20 }, { x: 0, y: 40, width: 20, height: 20 }],
    8,
    400,
  )

  assert.equal(result?.y, 80)
  assert.deepEqual(result?.guides.slice(-2), [
    { x1: 2, y1: 30, x2: 18, y2: 30 },
    { x1: 2, y1: 70, x2: 18, y2: 70 },
  ])
})

test('free objects snap to visible blocks, icons and text, but not themselves', () => {
  const moving = { id: 'moving', x: 94, y: 80, size: 20 }
  const hidden = { id: 'hidden', hidden: true, position: { x: 95, y: 0 }, dimensions: { width: 20, height: 20 }, data: {} }
  const block = { id: 'block', position: { x: 100, y: 0 }, dimensions: { width: 20, height: 20 }, data: {} }
  const icon = { id: 'icon', x: 200, y: 0, size: 20 }
  const text = { id: 'text', text: 'One', x: 300, y: 0, width: 20, height: 7 }
  const multiline = { id: 'multiline', text: 'One\nTwo', x: 300, y: 0, width: 100, height: 47 }

  assert.equal(mapModel.snapFreeObject({ x: 94, y: 80, width: 20, height: 20 }, moving, [hidden, block], [moving], [], 8, 400).x, 100)
  assert.equal(mapModel.snapFreeObject({ x: 194, y: 80, width: 20, height: 20 }, moving, [], [moving, icon], [], 8, 400).x, 200)
  assert.equal(mapModel.snapFreeObject({ x: 294, y: 80, width: 20, height: 20 }, moving, [], [moving], [text], 8, 400).x, 300)
  assert.equal(mapModel.snapFreeObject({ x: 500, y: 10, width: 20, height: 20 }, moving, [], [moving], [multiline], 8, 400).y, 13.5)
})

test('node marks keep the set order, one status at most, and toggle across a selection', () => {
  const { MARKS, normalizeMarks, toggleMark } = mapModel
  assert.deepEqual(MARKS.map((mark) => mark.key).join(''), '1234567890')
  assert.deepEqual(normalizeMarks(['milestone', 'future-mark', 'done', 'important', 'done']), ['important', 'done', 'milestone'])
  assert.deepEqual(normalizeMarks('done'), [])

  const a = makeNode('A', undefined, { marks: ['idea', 'done'] })
  const b = makeNode('B')
  assert.deepEqual(a.data.marks, ['done', 'idea'])
  assert.equal('marks' in b.data, false)

  // Missing on B → added there; A keeps it.
  toggleMark([a, b], 'idea')
  assert.deepEqual([a.data.marks, b.data.marks], [['done', 'idea'], ['idea']])
  // On both → removed from both, and an empty list is dropped.
  toggleMark([a, b], 'idea')
  assert.deepEqual(a.data.marks, ['done'])
  assert.equal('marks' in b.data, false)
  // A status replaces the other statuses and nothing else.
  toggleMark([a], 'important')
  toggleMark([a], 'question')
  assert.deepEqual(a.data.marks, ['important', 'question'])
  toggleMark([a], 'rejected')
  assert.deepEqual(a.data.marks, ['important', 'rejected'])
  // Taking a status off leaves the others alone.
  toggleMark([a], 'important')
  assert.deepEqual(a.data.marks, ['rejected'])
})

test('free mark resize keeps the opposite corner, the 16–128 range and the Shift step', () => {
  const { resizeFreeMark } = mapModel
  const mark = { id: 'm', mark: 'done', x: 100, y: 200, size: 40 }
  const far = (item) => [item.x + item.size, item.y + item.size]

  assert.deepEqual(resizeFreeMark(mark, 1, 1, 20, 20), { ...mark, size: 60 })
  // Half of the sum: a purely horizontal pull counts half.
  assert.equal(resizeFreeMark(mark, 1, 1, 20, 0).size, 50)
  const topLeft = resizeFreeMark(mark, -1, -1, -20, -20)
  assert.deepEqual([topLeft.size, topLeft.x, topLeft.y], [60, 80, 180])
  assert.deepEqual(far(topLeft), far(mark))
  const topRight = resizeFreeMark(mark, 1, -1, 10, -10)
  assert.deepEqual([topRight.size, topRight.x, topRight.y + topRight.size], [50, 100, 240])
  const bottomLeft = resizeFreeMark(mark, -1, 1, -10, 10)
  assert.deepEqual([bottomLeft.size, bottomLeft.x + bottomLeft.size, bottomLeft.y], [50, 140, 200])

  assert.equal(resizeFreeMark(mark, 1, 1, 500, 500).size, 128)
  const smallest = resizeFreeMark(mark, -1, -1, 500, 500)
  assert.deepEqual([smallest.size, ...far(smallest)], [16, ...far(mark)])
  assert.equal(resizeFreeMark(mark, 1, 1, 7.4, 7.4).size, 47)
  assert.equal(resizeFreeMark(mark, 1, 1, 7.4, 7.4, 8).size, 48)
})

test('free text sides resize width and height independently while the opposite edge stays still', () => {
  const resizeFreeText = mapModel.resizeFreeText ?? (() => ({}))
  const text = { id: 't', text: 'One\nTwo', x: 100, y: 200, width: 160, height: 75.2 }

  assert.deepEqual(resizeFreeText(text, 1, 0, 40, 90), { ...text, width: 200 })
  assert.deepEqual(resizeFreeText(text, -1, 0, -40, 90), { ...text, x: 60, width: 200 })
  assert.deepEqual(resizeFreeText(text, 0, 1, 90, 20), { ...text, height: 95.2 })
  assert.deepEqual(resizeFreeText(text, 0, -1, 90, -20), { ...text, y: 180, height: 95.2 })
  assert.deepEqual(resizeFreeText(text, -1, -1, -40, -20), {
    ...text, x: 60, y: 180, width: 200, height: 95.2,
  })
})

test('free text height grows by one text line for every explicit line break', () => {
  const freeTextHeight = mapModel.freeTextHeight ?? (() => 0)

  assert.equal(freeTextHeight('One'), 56)
  assert.equal(freeTextHeight('One\nTwo'), 75.2)
  assert.equal(freeTextHeight('One\nTwo\nThree'), 94.4)
})

test('a free text block starts with default text centered at the requested point', () => {
  const makeFreeText = mapModel.makeFreeText ?? (() => ({}))

  assert.deepEqual(makeFreeText({ x: 180, y: 128 }, 't1'), {
    id: 't1',
    text: 'Text',
    x: 100,
    y: 100,
    width: 160,
    height: 56,
  })
})

test('box selection fully contains free icons and text like Vue Flow nodes', () => {
  const selected = mapModel.freeObjectIdsInRect?.(
    { x: 10, y: 10, width: 100, height: 80 },
    [
      { id: 'inside-mark', x: 20, y: 20, size: 28 },
      { id: 'partial-mark', x: 100, y: 20, size: 28 },
    ],
    [
      { id: 'inside-text', text: 'Text', x: 20, y: 20, width: 80, height: 28 },
      { id: 'partial-text', text: 'Text', x: 40, y: 60, width: 160, height: 56 },
      { id: 'tall-text', text: 'One\nTwo\nThree', x: 20, y: 50, width: 80, height: 47.2 },
    ],
  )

  assert.deepEqual(selected, { markIds: ['inside-mark'], textIds: ['inside-text'] })
})

test('a mixed canvas selection moves every kind of block by the same delta', () => {
  const node = makeNode('Node', { x: 10, y: 20 })
  const mark = { id: 'mark', mark: 'done', x: 30, y: 40, size: 28 }
  const text = { id: 'text', text: 'Text', x: 50, y: 60, width: 160, height: 56 }

  mapModel.translateCanvasObjects?.([node], [mark, text], 15, -5)

  assert.deepEqual(node.position, { x: 25, y: 15 })
  assert.deepEqual([mark.x, mark.y], [45, 35])
  assert.deepEqual([text.x, text.y], [65, 55])
})

test('free text blocks keep independent dimensions and migrate legacy scale without changing the frame', () => {
  const map = normalizeMap({
    version: 2,
    nodes: [{ id: 'root', data: { label: 'Root' } }],
    edges: [],
    freeTexts: [
      { id: 't1', text: ' Caption ', x: 10, y: 20, width: 220, height: 90 },
      { id: 't1', text: 'Text', x: 0, y: 0 },
      { id: 'empty', text: '   ', x: 0, y: 0, size: 16 },
      { id: 'bad-position', text: 'Text', x: 'left', y: 0, size: 16 },
      { id: 'legacy', text: 'One\nTwo', x: 30, y: 40, size: 10 },
    ],
  })
  const texts = map.freeTexts ?? []

  assert.deepEqual(texts[0], { id: 't1', text: 'Caption', x: 10, y: 20, width: 220, height: 90 })
  assert.equal(texts.length, 3)
  assert.notEqual(texts[1].id, 't1')
  assert.deepEqual({ ...texts[1], id: 'generated' }, {
    id: 'generated', text: 'Text', x: 0, y: 0, width: 160, height: 56,
  })
  assert.deepEqual(texts[2], { id: 'legacy', text: 'One\nTwo', x: 30, y: 40, width: 100, height: 47 })
  assert.equal('freeTexts' in normalizeMap({ version: 2, nodes: [{ data: { label: 'A' } }], edges: [] }), false)
  assert.deepEqual(normalizeMap(JSON.parse(JSON.stringify(map))).freeTexts, map.freeTexts)
})

test('marks survive a save and load, unknown ones are skipped, and text exports prefix the title', () => {
  const map = normalizeMap({
    version: 2,
    title: 'Subscriptions',
    nodes: [
      { id: 'root', data: { label: 'Music', marks: ['nope'] } },
      { id: 'child', data: { label: 'Spotify', marks: ['idea', 'done'] } },
    ],
    edges: [{ source: 'root', target: 'child' }],
    freeMarks: [
      { id: 'm1', mark: 'favorite', x: 10, y: 20, size: 500 },
      { id: 'm1', mark: 'done', x: 0, y: 0 },
      { id: 'm3', mark: 'nope', x: 0, y: 0, size: 28 },
      { id: 'm4', mark: 'done', x: 'left', y: 0, size: 28 },
    ],
  })
  assert.equal('marks' in map.nodes[0].data, false)
  assert.deepEqual(map.nodes[1].data.marks, ['done', 'idea'])
  assert.deepEqual(map.freeMarks[0], { id: 'm1', mark: 'favorite', x: 10, y: 20, size: 128 })
  assert.equal(map.freeMarks.length, 2)
  assert.notEqual(map.freeMarks[1].id, 'm1')
  assert.equal(map.freeMarks[1].size, 28)
  assert.equal('freeMarks' in normalizeMap({ version: 2, nodes: [{ data: { label: 'A' } }], edges: [] }), false)
  assert.deepEqual(normalizeMap(JSON.parse(JSON.stringify(map))).freeMarks, map.freeMarks)

  assert.match(toMarkdown(map), /^- Music\n  - \[Done\] \[Idea\] Spotify$/m)
  assert.match(toOpml(map), /<outline text="\[Done\] \[Idea\] Spotify"\/>/)
  assert.doesNotMatch(toMarkdown(map), /Favorite/)
})

test('links are their own list: old link edges convert, bad and repeated ones drop', () => {
  const map = normalizeMap({
    version: 2,
    nodes: ['a', 'b', 'c'].map((id) => ({ id, data: { label: id } })),
    edges: [
      makeEdge('a', 'b'),
      // Saved before links left the edges: pinned to anchor points that no longer exist.
      { id: 'old', source: 'b', target: 'c', sourceHandle: 'link-left-2', targetHandle: 'link-top-3', data: { kind: 'link' } },
    ],
    links: [
      { id: 'l1', from: 'a', to: 'c', label: '  uses  ', arrows: 'both' },
      { id: 'l1', from: 'c', to: 'a', arrows: 'sideways' },
      { from: 'a', to: 'c' },
      { from: 'a', to: 'a' },
      { from: 'a', to: 'gone' },
    ],
  })

  assert.deepEqual(map.edges.map((edge) => [edge.source, edge.target, edge.data.kind]), [['a', 'b', 'tree']])
  assert.deepEqual(map.links.map(({ id, ...link }) => link), [
    { from: 'a', to: 'c', label: 'uses', arrows: 'both' },
    { from: 'c', to: 'a' },
    { from: 'b', to: 'c' },
  ])
  assert.equal(new Set(map.links.map((link) => link.id)).size, 3)
  assert.deepEqual(normalizeMap(JSON.parse(JSON.stringify(map))).links, map.links)
  assert.equal('links' in normalizeMap({ nodes: [{ id: 'a', data: { label: 'a' } }], edges: [] }), false)

  assert.equal(mapModel.canLink(map.links, 'a', 'b'), true)
  assert.equal(mapModel.canLink(map.links, 'a', 'a'), false)
  assert.equal(mapModel.canLink(map.links, 'a', 'c'), false)
  // Re-attaching a link to where it already is changes nothing but is allowed.
  assert.equal(mapModel.canLink(map.links, 'a', 'c', 'l1'), true)
})

test('link sides follow the blocks', () => {
  const { linkSides } = mapModel
  const box = (x, y, more = {}) => ({ x, y, width: 100, height: 30, side: 'right', level: 2, ...more })

  // Facing sides: sideways when the blocks are further apart across than down.
  assert.deepEqual(linkSides(box(0, 0, { side: 'root' }), box(400, 50, { side: 'root' })), ['right', 'left'])
  assert.deepEqual(linkSides(box(400, 50, { side: 'root' }), box(0, 0, { side: 'root' })), ['left', 'right'])
  assert.deepEqual(linkSides(box(0, 0, { level: 1 }), box(80, 300)), ['bottom', 'top'])
  assert.deepEqual(linkSides(box(80, 300), box(0, 0, { level: 1 })), ['top', 'bottom'])
  // The side the tree branch arrives at stays free while the link has another way out.
  assert.deepEqual(linkSides(box(0, 0, { level: 1 }), box(400, 50)), ['right', 'top'])
  assert.deepEqual(linkSides(box(0, 50, { level: 1 }), box(400, 0)), ['right', 'bottom'])
  assert.deepEqual(linkSides(box(400, 50), box(0, 0, { side: 'root', level: 0 })), ['top', 'right'])
  assert.deepEqual(linkSides(box(0, 0, { level: 1 }), box(400, 0)), ['right', 'left'])
  // Neighbours in one column bow out on the outer side, whatever their widths.
  assert.deepEqual(linkSides(box(0, 100), box(0, 0, { width: 240 })), ['right', 'right'])
  assert.deepEqual(linkSides(box(0, 0, { side: 'left' }), box(-60, 100, { side: 'left', width: 160 })), ['left', 'left'])
  assert.deepEqual(linkSides(box(0, 0), box(0, 100, { level: 3 })), ['bottom', 'top'])
  // The pointer of a link being dragged is a bare point.
  assert.deepEqual(linkSides(box(0, 0), { x: 300, y: 20, width: 0, height: 0 }), ['right', 'left'])
})

const pathPoints = (d) => [...d.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
  .map(([, x, y]) => ({ x: Number(x), y: Number(y) }))

const assertOrthogonal = (d) => {
  assert.doesNotMatch(d, /[CQAST]/)
  const points = pathPoints(d)
  assert.ok(points.length >= 2)
  for (let index = 1; index < points.length; index += 1) {
    assert.ok(points[index - 1].x === points[index].x || points[index - 1].y === points[index].y)
  }
  return points
}

const routeOverlap = (first, second) => {
  let overlap = 0
  for (let a = 1; a < first.length; a += 1) {
    for (let b = 1; b < second.length; b += 1) {
      const [a1, a2, b1, b2] = [first[a - 1], first[a], second[b - 1], second[b]]
      if (a1.x === a2.x && b1.x === b2.x && a1.x === b1.x) {
        overlap += Math.max(0, Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y))
          - Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y)))
      } else if (a1.y === a2.y && b1.y === b2.y && a1.y === b1.y) {
        overlap += Math.max(0, Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x))
          - Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x)))
      }
    }
  }
  return overlap
}

test('a link is an orthogonal polyline square to its sides, with the arrowhead off the frame', () => {
  const { linkAnchor, linkFrame, linkPath, nearestLinkSide } = mapModel
  const source = { x: 34, y: 144, width: 230, height: 48 }
  const target = { x: 34, y: 20, width: 230, height: 48 }

  assert.deepEqual(linkFrame(source), { x: 28, y: 138, width: 242, height: 60 })
  assert.deepEqual(['top', 'right', 'bottom', 'left'].map((side) => linkAnchor(source, side)).map(({ x, y }) => [x, y]),
    [[149, 138], [270, 168], [149, 198], [28, 168]])
  assert.equal(nearestLinkSide(source, { x: 260, y: 170 }), 'right')
  assert.equal(nearestLinkSide(source, { x: 150, y: 150 }), 'top')
  assert.equal(nearestLinkSide(source, { x: 150, y: 200 }), 'bottom')
  assert.equal(nearestLinkSide(source, { x: 30, y: 168 }), 'left')
  assert.deepEqual(linkAnchor(source, 'right', 6, -8), { x: 270, y: 160, nx: 1, ny: 0 })
  assert.deepEqual(linkAnchor(source, 'top', 6, 8), { x: 157, y: 138, nx: 0, ny: -1 })
  assert.deepEqual(mapModel.linkAnchorOffsets?.(1, 30), [0])
  assert.deepEqual(mapModel.linkAnchorOffsets?.(2, 30), [-5, 5])
  assert.deepEqual(mapModel.linkAnchorOffsets?.(5, 30), [-15, -7.5, 0, 7.5, 15])

  const obstacles = [source, target]
  const path = linkPath(linkAnchor(source, 'right'), linkAnchor(target, 'right'), 'end', obstacles)
  assert.equal(path.d, 'M270,168 L286,168 L286,44 L278,44')
  assertOrthogonal(path.d)
  assert.deepEqual(path.arrows, ['M279,48 L272,44 L279,40'])
  assert.deepEqual(path.middle, { x: 286, y: 110 })
  assert.deepEqual(path.ends, { from: { x: 270, y: 168 }, to: { x: 274, y: 44 } })

  const both = linkPath(linkAnchor(source, 'right'), linkAnchor(target, 'right'), 'both', obstacles)
  assert.equal(both.d, 'M278,168 L286,168 L286,44 L278,44')
  assert.equal(both.arrows.length, 2)
  const none = linkPath(linkAnchor(source, 'right'), linkAnchor(target, 'right'), 'none', obstacles)
  assert.equal(none.d, 'M270,168 L286,168 L286,44 L270,44')
  assert.deepEqual(none.arrows, [])
})

test('an orthogonal link takes a clear corridor around a blocking node', () => {
  const { linkAnchor, linkPath } = mapModel
  const source = { x: 0, y: 40, width: 40, height: 20 }
  const blocker = { x: 100, y: 20, width: 40, height: 60 }
  const target = { x: 200, y: 40, width: 40, height: 20 }
  const path = linkPath(linkAnchor(source, 'right'), linkAnchor(target, 'left'), 'none', [source, blocker, target])
  const points = assertOrthogonal(path.d)
  const blocked = { left: 94, right: 146, top: 14, bottom: 86 }
  const crosses = (a, b) => a.x === b.x
    ? a.x > blocked.left && a.x < blocked.right && Math.max(a.y, b.y) > blocked.top && Math.min(a.y, b.y) < blocked.bottom
    : a.y > blocked.top && a.y < blocked.bottom && Math.max(a.x, b.x) > blocked.left && Math.min(a.x, b.x) < blocked.right

  assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
  assert.ok(points.slice(1).every((point, index) => !crosses(points[index], point)))
  assert.ok(points[1].x > points[0].x)
  assert.ok(points.at(-2).x < points.at(-1).x)
  assert.ok(points.some((point) => point.y < blocked.top || point.y > blocked.bottom))
})

test('orthogonal routing stays finite when every candidate crosses an obstacle', () => {
  const path = mapModel.linkPath(
    { x: 0, y: 0, nx: 1, ny: 0 },
    { x: 100, y: 100, nx: -1, ny: 0 },
    'none',
    [{ x: -20, y: -20, width: 140, height: 140 }],
  )

  assertOrthogonal(path.d)
  assert.ok(Number.isFinite(path.middle.x))
  assert.ok(Number.isFinite(path.middle.y))
})

test('a link chooses a different dogleg instead of covering an occupied segment', () => {
  const first = mapModel.linkPath(
    { x: 0, y: 0, nx: 1, ny: 0 },
    { x: 100, y: 100, nx: -1, ny: 0 },
    'none',
  )
  const occupied = [pathPoints(first.d).map(({ x, y }) => [x, y])]
  const second = mapModel.linkPath(
    { x: 0, y: 20, nx: 1, ny: 0 },
    { x: 100, y: 120, nx: -1, ny: 0 },
    'none',
    [],
    occupied,
  )
  const points = assertOrthogonal(second.d)

  assert.equal(routeOverlap(pathPoints(first.d), points), 0)
  assert.deepEqual(second.points, points.map(({ x, y }) => [x, y]))
})

test('links spread on one block side also use separate departure turns', () => {
  const source = { x: 600, y: 300, width: 100, height: 30 }
  const upper = { x: 600, y: 200, width: 100, height: 30 }
  const left = { x: 200, y: 200, width: 100, height: 30 }
  const obstacles = [source, upper, left]
  const first = mapModel.linkPath(
    mapModel.linkAnchor(source, 'top', 6, -5),
    mapModel.linkAnchor(upper, 'bottom'),
    'end',
    obstacles,
  )
  const second = mapModel.linkPath(
    mapModel.linkAnchor(source, 'top', 6, 5),
    mapModel.linkAnchor(left, 'right'),
    'end',
    obstacles,
    [first.points],
  )

  assert.equal(routeOverlap(pathPoints(first.d), pathPoints(second.d)), 0)
})

test('a link preview can take an unused anchor slot without moving drawn links', () => {
  const one = mapModel.nextLinkAnchorOffset?.([0], 30)
  const two = mapModel.nextLinkAnchorOffset?.([-5, 5], 30)

  assert.ok(![0].includes(one) && Math.abs(one) <= 15)
  assert.ok(![-5, 5].includes(two) && Math.abs(two) <= 15)
})

test('a point crossing does not push a link into a detour', () => {
  const crossing = [[[50, -100], [50, 100]]]
  const path = mapModel.linkPath(
    { x: 0, y: 0, nx: 1, ny: 0 },
    { x: 100, y: 0, nx: -1, ny: 0 },
    'none',
    [],
    crossing,
  )

  assert.equal(path.d, 'M0,0 L100,0')
})

test('library keeps valid Drive backup metadata and drops broken ones', () => {
  const map = starterMap()
  const backup = { fileId: 'f1', driveVersion: '7', md5Checksum: 'abc', saveId: 's1', state: 'linked', name: 'Plan.mindmap', folder: 'Mindspace', savedAt: 1700000000000, pending: true }
  const { documents } = normalizeLibrary({ documents: [
    { id: 'a', map, googleDriveBackup: backup },
    { id: 'b', map, googleDriveBackup: { ...backup, state: 'conflict', pending: false, savedAt: 'soon', token: 'secret' } },
    { id: 'c', map, googleDriveBackup: { ...backup, state: 'paused', driveVersion: 7, name: null } },
    { id: 'd', map, googleDriveBackup: { ...backup, fileId: '' } },
    { id: 'e', map, googleDriveBackup: 'f1' },
    { id: 'f', map },
  ] })
  assert.deepEqual(documents[0].googleDriveBackup, backup)
  assert.deepEqual(documents[1].googleDriveBackup, { fileId: 'f1', driveVersion: '7', md5Checksum: 'abc', saveId: 's1', state: 'conflict', name: 'Plan.mindmap', folder: 'Mindspace' })
  assert.deepEqual(documents[2].googleDriveBackup, { ...backup, driveVersion: '', name: '' })
  for (const index of [3, 4, 5]) assert.equal('googleDriveBackup' in documents[index], false)
})

test('obsolete uncertain-save metadata is dropped from the link', () => {
  const map = starterMap()
  const backup = { fileId: 'f1', driveVersion: '7', md5Checksum: 'abc', saveId: 's1', state: 'linked', name: 'Plan.mindmap', folder: '' }
  const { documents } = normalizeLibrary({ documents: [
    { id: 'a', map, googleDriveBackup: { ...backup, sentSaveId: 's2' } },
    { id: 'b', map, googleDriveBackup: { ...backup, sentSaveId: 5 } },
    { id: 'c', map, googleDriveBackup: { ...backup, sentSaveId: '' } },
  ] })
  assert.deepEqual(documents[0].googleDriveBackup, backup)
  assert.deepEqual(documents[1].googleDriveBackup, backup)
  assert.deepEqual(documents[2].googleDriveBackup, backup)
})
