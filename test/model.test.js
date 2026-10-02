import test from 'node:test'
import assert from 'node:assert/strict'
import { COLORS, highlightParts, nextMatch, normalizeSearch, searchOrder, PALETTES, descendantsOf, insertTreeEdgeAfter, layoutVerticalGap, nodeInDirection, nodeStyle, normalizeSettings, plural, recolorForPalette, layoutNodes, makeEdge, makeNode, normalizeLibrary, normalizeMap, pluralNodes, relativeTime, shiftNodesBelow, starterMap, toOpml } from '../src/model.js'

test('tree helpers keep descendants and layout predictable', () => {
  const root = makeNode('root', {}, { id: 'root', root: true })
  const child = makeNode('child', {}, { id: 'child' })
  const leaf = makeNode('leaf', {}, { id: 'leaf' })
  const edges = [makeEdge('root', 'child'), makeEdge('child', 'leaf')]

  assert.deepEqual([...descendantsOf('root', edges)], ['child', 'leaf'])
  const laidOut = layoutNodes([root, child, leaf], edges)
  assert.ok(laidOut.find((node) => node.id === 'child').position.x > laidOut[0].position.x)
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
    makeEdge('root', 'first', 'tree', 'edge-first'),
    makeEdge('root', 'last', 'tree', 'edge-last'),
  ]
  insertTreeEdgeAfter(edges, makeEdge('root', 'middle', 'tree', 'edge-middle'), 'first')

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
    edges: [makeEdge('root', 'child'), makeEdge('child', 'other', 'link')],
  })
  map.nodes[1].data.note = '7.90 € / мес'
  const opml = toOpml(map)
  assert.match(opml, /<outline text="Child" _note="7.90 € \/ мес"\/>/)
  assert.match(opml, /<title>A &#38; B<\/title>/)
  assert.match(opml, /<outline text="Root &#60;1&#62;">\n\s+<outline text="Child"[^>]*\/>\n\s+<\/outline>/)
  assert.match(opml, /<outline text="Other"\/>/)
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
