// Shortcut registry: key handlers run off it, and the Keyboard shortcuts dialog is built from it.
// Entries without match are handled by another keydown (Vue Flow or the node editor) — they are for reference only.

export const IS_MAC = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '')

// Keys Vue Flow listens to itself; the same values go into its settings.
export const PAN_KEY = 'Space'
export const MULTI_SELECT_KEY = 'Shift'

// Symbols on Mac, names on Windows and Linux.
const KEY_NAMES = {
  Mod: ['⌘', 'Ctrl'],
  Ctrl: ['⌃', 'Ctrl'],
  Alt: ['⌥', 'Alt'],
  Shift: ['⇧', 'Shift'],
  Delete: ['⌫', 'Del'],
}

export function keyLabel(key, mac = IS_MAC) {
  const names = KEY_NAMES[key]
  return names ? names[mac ? 0 : 1] : key
}

const hasMod = (event) => event.metaKey || event.ctrlKey
const letter = (event) => event.key.toLowerCase()

export const SHORTCUT_GROUPS = ['Nodes', 'Editing', 'Canvas', 'Branches', 'Maps', 'General']

export const SHORTCUTS = [
  { id: 'addChild', group: 'Nodes', label: 'Child node', keys: ['Tab'], match: (event) => event.key === 'Tab' && !event.shiftKey },
  { id: 'addSibling', group: 'Nodes', label: 'Sibling node', keys: ['Enter'], match: (event) => event.key === 'Enter' },
  {
    id: 'navigate',
    group: 'Nodes',
    label: 'Between nodes',
    keys: ['←', '↑', '→', '↓'],
    bindings: [['←'], ['↑'], ['→'], ['↓']],
    match: (event) => !event.altKey && !event.metaKey && !event.ctrlKey
      && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key),
  },
  { id: 'typeToEdit', group: 'Nodes', label: 'Edit selected node', keys: ['type'] },
  { id: 'copyBranch', group: 'Nodes', label: 'Copy branch', keys: ['Mod', 'C'] },
  { id: 'paste', group: 'Nodes', label: 'Paste on canvas', keys: ['Mod', 'V'] },
  // { id: 'edit', group: 'Nodes', label: 'Edit text', keys: ['double-click'] },
  { id: 'remove', group: 'Nodes', label: 'Delete node', keys: ['Delete'], match: (event) => event.key === 'Delete' || event.key === 'Backspace' },
  { id: 'link', group: 'Nodes', label: 'Link nodes', keys: ['drag from edge'] },
  { id: 'noteLine', group: 'Editing', label: 'Description field', keys: ['Tab'], bindings: [['Tab'], ['Shift', 'Enter']] },
  { id: 'finishEdit', group: 'Editing', label: 'Finish editing', keys: ['Enter'] },
  { id: 'cancelEdit', group: 'Editing', label: 'Cancel editing', keys: ['Esc'] },
  { id: 'pan', group: 'Canvas', label: 'Pan', keys: [PAN_KEY, 'drag'] },
  { id: 'zoom', group: 'Canvas', label: 'Zoom', keys: ['Mod', 'wheel'] },
  { id: 'boxSelect', group: 'Canvas', label: 'Box select', keys: ['drag on canvas'] },
  { id: 'deselect', group: 'Canvas', label: 'Deselect', keys: ['Esc'], match: (event) => event.key === 'Escape' },
  { id: 'collapse', group: 'Branches', label: 'Collapse', keys: ['Alt', '←'], match: (event) => event.altKey && event.key === 'ArrowLeft' },
  { id: 'expand', group: 'Branches', label: 'Expand', keys: ['Alt', '→'], match: (event) => event.altKey && event.key === 'ArrowRight' },
  { id: 'multiSelect', group: 'Branches', label: 'Select multiple', keys: [MULTI_SELECT_KEY, 'click'] },
  { id: 'mapNavigate', group: 'Maps', label: 'Move through map list', keys: ['↑', '↓'], bindings: [['↑'], ['↓']] },
  { id: 'mapOpen', group: 'Maps', label: 'Open map', keys: ['Enter'] },
  { id: 'mapRename', group: 'Maps', label: 'Rename map', keys: ['F2'] },
  { id: 'mapDuplicate', group: 'Maps', label: 'Duplicate map', keys: ['Mod', 'D'] },
  { id: 'mapDelete', group: 'Maps', label: 'Delete map', keys: ['Delete'] },
  { id: 'mapMenu', group: 'Maps', label: 'Open map menu', keys: ['Shift', 'F10'] },
  { id: 'undo', group: 'General', label: 'Undo', keys: ['Mod', 'Z'], match: (event) => hasMod(event) && !event.shiftKey && letter(event) === 'z' },
  {
    id: 'redo',
    group: 'General',
    label: 'Redo',
    keys: ['Shift', 'Mod', 'Z'],
    bindings: [['Shift', 'Mod', 'Z'], ['Mod', 'Y']],
    match: (event) => hasMod(event) && ((event.shiftKey && letter(event) === 'z') || letter(event) === 'y'),
  },
  { id: 'search', group: 'General', label: 'Search', keys: ['Mod', 'F'], match: (event) => hasMod(event) && !event.shiftKey && !event.altKey && (letter(event) === 'f' || event.code === 'KeyF') },
  { id: 'theme', group: 'General', label: 'Switch theme', keys: ['Shift', 'Mod', 'L'], match: (event) => hasMod(event) && event.shiftKey && !event.altKey && (letter(event) === 'l' || event.code === 'KeyL') },
  // On the Russian layout Shift+/ produces a comma — check the physical key too.
  { id: 'help', group: 'General', label: 'This help', keys: ['?'], match: (event) => !hasMod(event) && (event.key === '?' || (event.shiftKey && event.code === 'Slash')) },
]

export function findShortcut(event) {
  return SHORTCUTS.find((shortcut) => shortcut.match?.(event))
}

export function shortcutKeys(id, mac = IS_MAC) {
  return (SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? []).map((key) => keyLabel(key, mac))
}

export function shortcutGroups(mac = IS_MAC) {
  return SHORTCUT_GROUPS.map((title) => ({
    title,
    items: SHORTCUTS
      .filter((shortcut) => shortcut.group === title)
      .map((shortcut) => ({
        id: shortcut.id,
        label: shortcut.label,
        keys: shortcut.keys.map((key) => keyLabel(key, mac)),
        bindings: (shortcut.bindings ?? [shortcut.keys])
          .map((binding) => binding.map((key) => keyLabel(key, mac))),
      })),
  }))
}
