# Mindspace

A local mind-mapping app built with Vue 3 and Vue Flow. Everything runs in the browser: there is no server or account, and maps are saved automatically on your device.

## Features

- **Several maps.** Create, rename, duplicate, delete and search maps from the switcher next to the map title. A deleted map can be restored from the notification.
- **Editing.** Add child and sibling nodes, edit text in place, and add a gray second line for details such as a price or a note. Collapse and expand branches, select several nodes at once, and draw free links between any two nodes by dragging from a node's edge.
- **Drag to reattach.** Drag a node or a branch onto another node to move it there. While you drag, a preview line shows where it will attach.
- **Layout.** Turn on auto layout and choose a direction (right, both sides or tree), smooth or straight lines, and the spacing. With auto layout off, nodes stay where you put them.
- **Inspector panel.** Change a node's text, branch color and style (line, card or text), or change map-wide settings such as the branch palette (Bright, Calm or Mono).
- **Undo and redo** for every change.
- **Import and export.** Download a map as a `.mindmap` file (JSON) or as an OPML outline. Open `.mindmap`, `.json` and `.opml` files as new maps.
- **Keyboard shortcuts.** Press <kbd>?</kbd> to see them all.
- **App menu.** The menu shows the app version (click to copy it) and links to the release notes and to the issue tracker.

First-time visitors see a short welcome map that demonstrates the main features.

## Storage

Maps live in the browser's `localStorage` under the `mindspace-library-v1` key. Clearing site data removes them, so export the maps you want to keep. Maps saved by older versions under `mindspace-map-v1` are migrated automatically.

## Development

Requires Node.js 20.19 or later (needed by Vite 7).

```bash
npm install
npm run dev      # start the dev server
npm test         # run unit tests (node --test)
npm run build    # production build into dist/
```

The app version and repository URL come from `package.json` and appear in the app menu. The "What's new" item links to the GitHub release `v<version>`.

## Project structure

- `src/App.vue`: the app UI, including the canvas, toolbars, inspector, menus and dialogs.
- `src/model.js`: the map model, covering normalization, layout, palettes, OPML import and export, and the welcome map.
- `src/shortcuts.js`: the keyboard shortcut registry used by the key handlers and the help dialog.
- `src/style.css`: styles.
- `test/`: unit tests for the model and shortcuts.
