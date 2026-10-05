import test from 'node:test'
import assert from 'node:assert/strict'
import { makeEdge, makeNode } from '../src/model.js'
import {
  ClipboardPayloadError,
  MINDSPACE_CLIPBOARD_TYPE,
  parseClipboardData,
  parseMindspaceClipboard,
  serializeClipboardBranches,
  translateClipboardFragment,
} from '../src/clipboard.js'

const ids = () => {
  let index = 0
  return () => `new-${++index}`
}

const clipboard = (entries) => ({
  types: Object.keys(entries),
  getData: (type) => entries[type] ?? '',
})

test('serializes complete selected branches without overlap', () => {
  const root = makeNode('Root', { x: 0, y: 0 }, { id: 'root', root: true })
  const child = makeNode('Child', { x: 200, y: 0 }, { id: 'child' })
  const leaf = makeNode('Leaf', { x: 400, y: 0 }, { id: 'leaf' })
  const result = serializeClipboardBranches(
    [root, child, leaf],
    [makeEdge('root', 'child', 'tree', 'root-child'), makeEdge('child', 'leaf', 'tree', 'child-leaf')],
    ['root', 'child'],
  )
  const payload = JSON.parse(result.custom)

  assert.equal(MINDSPACE_CLIPBOARD_TYPE, 'application/x-mindspace-branch+json')
  assert.equal(payload.version, 1)
  assert.deepEqual(payload.roots, ['root'])
  assert.deepEqual(payload.nodes.map((node) => node.id), ['root', 'child', 'leaf'])
  assert.equal(result.count, 3)
  assert.equal(result.text, 'Root\n\tChild\n\t\tLeaf')
})

test('keeps only internal edges and preserves node data', () => {
  const image = { assetId: 'asset-1', name: 'photo.png', mime: 'image/png', naturalWidth: 80, naturalHeight: 60 }
  const root = makeNode('Root', { x: 10, y: 20 }, {
    id: 'root', root: true, note: 'Details', color: '#E9A23B', style: 'card', manualColor: true, collapsed: true, image,
  })
  const child = makeNode('Child', { x: 220, y: 30 }, { id: 'child', color: '#E9A23B' })
  const outside = makeNode('Outside', { x: 500, y: 0 }, { id: 'outside', root: true })
  const result = serializeClipboardBranches(
    [root, child, outside],
    [
      makeEdge('root', 'child', 'tree', 'tree'),
      makeEdge('root', 'child', 'link', 'link'),
      makeEdge('child', 'outside', 'link', 'crossing'),
    ],
    ['root'],
  )
  const payload = JSON.parse(result.custom)

  assert.deepEqual(payload.edges.map((edge) => edge.id), ['tree', 'link'])
  assert.deepEqual(payload.nodes[0], {
    id: 'root',
    type: 'mind',
    position: { x: 10, y: 20 },
    data: {
      label: 'Root', note: 'Details', color: '#E9A23B', style: 'card', manualColor: true,
      collapsed: true, root: true, side: 'root', image,
    },
  })
})

test('remaps every node and edge id on parse', () => {
  const root = makeNode('Root', { x: 10, y: 20 }, { id: 'root', root: true })
  const child = makeNode('Child', { x: 210, y: 20 }, { id: 'child' })
  const serialized = serializeClipboardBranches([root, child], [
    makeEdge('root', 'child', 'tree', 'tree'),
    makeEdge('root', 'child', 'link', 'link'),
  ], ['root'])

  const fragment = parseMindspaceClipboard(serialized.custom, ids())

  assert.deepEqual(fragment.roots, ['new-1'])
  assert.deepEqual(fragment.nodes.map((node) => node.id), ['new-1', 'new-2'])
  assert.deepEqual(fragment.edges.map((edge) => [edge.id, edge.source, edge.target, edge.data.kind]), [
    ['new-3', 'new-1', 'new-2', 'tree'],
    ['new-4', 'new-1', 'new-2', 'link'],
  ])
  assert.equal(fragment.source, 'mindspace')
})

test('normalizes broken and cyclic tree edges to a finite forest', () => {
  const payload = JSON.stringify({
    version: 1,
    roots: ['a'],
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'b', position: { x: 200, y: 0 }, data: { label: 'B' } },
      { id: 'c', position: { x: 400, y: 0 }, data: { label: 'C' } },
    ],
    edges: [
      { id: 'a-b', source: 'a', target: 'b', data: { kind: 'tree' } },
      { id: 'b-a', source: 'b', target: 'a', data: { kind: 'tree' } },
      { id: 'c-b', source: 'c', target: 'b', data: { kind: 'tree' } },
      { id: 'broken', source: 'b', target: 'missing', data: { kind: 'tree' } },
    ],
  })

  const fragment = parseMindspaceClipboard(payload, ids())

  assert.deepEqual(fragment.roots, ['new-1', 'new-3'])
  assert.deepEqual(fragment.edges.map((edge) => [edge.source, edge.target]), [['new-1', 'new-2']])
})

test('translates fragment bounds around a requested center', () => {
  const fragment = {
    source: 'mindspace',
    roots: ['root'],
    nodes: [
      makeNode('Root', { x: 0, y: 0 }, { id: 'root', root: true }),
      makeNode('Child', { x: 300, y: 100 }, { id: 'child' }),
    ],
    edges: [makeEdge('root', 'child', 'tree', 'edge')],
  }

  const translated = translateClipboardFragment(fragment, { x: 500, y: 500 })

  assert.deepEqual(translated.nodes.map((node) => node.position), [{ x: 260, y: 435 }, { x: 560, y: 535 }])
  assert.deepEqual(fragment.nodes.map((node) => node.position), [{ x: 0, y: 0 }, { x: 300, y: 100 }])
})

test('custom Mindspace data has precedence', () => {
  const branch = serializeClipboardBranches(
    [makeNode('Mindspace', {}, { id: 'root', root: true })],
    [],
    ['root'],
  )

  const fragment = parseClipboardData(clipboard({
    [MINDSPACE_CLIPBOARD_TYPE]: branch.custom,
    'text/plain': 'Wrong fallback',
  }), ids())

  assert.equal(fragment.source, 'mindspace')
  assert.deepEqual(fragment.nodes.map((node) => node.data.label), ['Mindspace'])
})

test('rejects corrupt Mindspace data without using text fallback', () => {
  assert.throws(() => parseClipboardData(clipboard({
    [MINDSPACE_CLIPBOARD_TYPE]: '{broken',
    'text/plain': '{broken',
  }), ids()), ClipboardPayloadError)
})

test('reads OPML roots and children', () => {
  // XMind can expose an outline representation when topics are copied.
  const fragment = parseClipboardData(clipboard({
    'text/plain': '<?xml version="1.0"?><opml><body><outline text="Plan"><outline text="Ship &amp; learn"/></outline><outline text="Review"/></body></opml>',
  }), ids())

  assert.equal(fragment.source, 'opml')
  assert.deepEqual(fragment.nodes.map((node) => node.data.label), ['Plan', 'Ship & learn', 'Review'])
  assert.deepEqual(fragment.edges.map((edge) => [edge.source, edge.target]), [['new-1', 'new-2']])
  assert.deepEqual(fragment.roots, ['new-1', 'new-3'])
})

test('reads nested HTML lists', () => {
  // MindNode and Coggle expose nested list-shaped HTML in compatible clipboard paths.
  const fragment = parseClipboardData(clipboard({
    'text/html': '<ul><li>Plan<ul><li>Research</li><li>Ship &amp; learn</li></ul></li></ul>',
    'text/plain': 'Plan\nResearch\nShip & learn',
  }), ids())

  assert.equal(fragment.source, 'html')
  assert.deepEqual(fragment.nodes.map((node) => node.data.label), ['Plan', 'Research', 'Ship & learn'])
  assert.deepEqual(fragment.edges.map((edge) => [edge.source, edge.target]), [
    ['new-1', 'new-2'],
    ['new-1', 'new-3'],
  ])
})

test('reads explicit Markdown lists', () => {
  // Miro's copy-as-text path is represented as explicit list items when structure is available.
  const fragment = parseClipboardData(clipboard({
    'text/plain': '- Product\n  - Research\n  - Launch',
  }), ids())

  assert.equal(fragment.source, 'outline')
  assert.deepEqual(fragment.nodes.map((node) => node.data.label), ['Product', 'Research', 'Launch'])
  assert.deepEqual(fragment.edges.map((edge) => [edge.source, edge.target]), [
    ['new-1', 'new-2'],
    ['new-1', 'new-3'],
  ])
})

test('reads tab-indented service outlines', () => {
  // XMind, MindNode, and Coggle all have outline views that preserve hierarchy as tabs.
  const fragment = parseClipboardData(clipboard({
    'text/plain': 'Root\n\tChild\n\t\tLeaf\n\tSibling',
  }), ids())

  assert.equal(fragment.source, 'outline')
  assert.deepEqual(fragment.nodes.map((node) => node.data.label), ['Root', 'Child', 'Leaf', 'Sibling'])
  assert.deepEqual(fragment.edges.map((edge) => [edge.source, edge.target]), [
    ['new-1', 'new-2'],
    ['new-2', 'new-3'],
    ['new-1', 'new-4'],
  ])
})

test('keeps multiline prose in one root', () => {
  const fragment = parseClipboardData(clipboard({
    'text/plain': 'First paragraph\nSecond paragraph',
  }), ids())

  assert.equal(fragment.source, 'text')
  assert.equal(fragment.nodes.length, 1)
  assert.equal(fragment.nodes[0].data.label, 'First paragraph\nSecond paragraph')
  assert.deepEqual(fragment.edges, [])
})

test('returns null for empty clipboard data', () => {
  assert.equal(parseClipboardData(clipboard({ 'text/plain': ' \n ' }), ids()), null)
})
