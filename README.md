<div align="center">

<img src="public/logo.svg" width="72" height="72" alt="mindspace logo">

# mindspace

**Local-first mind maps in your browser.**
Fast to type, calm to look at, and your data never leaves your device.

[Try it](https://dasmindspace.app/) · [Report a bug](https://github.com/alardus/mindspace/issues/new) · [Changelog](https://github.com/alardus/mindspace/tags)

[![deploy](https://img.shields.io/github/deployments/alardus/mindspace/Production?label=vercel&logo=vercel)](https://dasmindspace.app/)
![version](https://img.shields.io/github/package-json/v/alardus/mindspace?color=1F2421&label=version)
![license](https://img.shields.io/github/license/alardus/mindspace?color=1F2421)

<!-- <img src="docs/screenshot-light.png" width="860" alt="mindspace — a subscriptions map in light theme"> -->

</div>

## Why mindspace

Most mind-map tools are either cloud editors with accounts and paywalls, or desktop apps from another decade. mindspace is a single web page: open it and start typing. Maps are saved locally, work offline, and export to plain files you own.

## Features

- **Keyboard-first editing.** `Tab` for a child, `Enter` for a sibling, and just start typing to edit the selected node. You can build a whole map without touching the mouse.
- **Two-line nodes.** A title plus a quiet secondary line for prices, dates, or notes. Numbers line up.
- **Search across the map.** `⌘F` highlights matches, dims everything else, and pans to each result, even inside collapsed branches.
- **Many maps, one place.** Switch, rename, duplicate, and delete maps from a single menu, with undo for deletions.
- **Drag to rearrange.** Drop a node or a whole branch onto another node to reattach it, or draw free links between any two nodes.
- **Copy and paste.** Copy complete branches between maps, paste outlines from XMind, Miro, MindNode, or Coggle, or paste plain text as one independent root block.
- **Images.** Paste or drop PNG, JPEG, WebP, or GIF files up to 10 MB onto the canvas, as a block of their own or inside a node.
- **Auto layout.** Branches to the right, on both sides, or as a tree, with smooth or straight lines and adjustable spacing. Turn it off to place nodes by hand.
- **Branch palettes.** Bright, Calm, or Mono, plus per-branch colors inherited by children.
- **Light and dark themes.** Follows your system or set manually; branch colors adapt to each theme.
- **Import and export.** `.mindmap` files for backups (images included), plus OPML and Markdown outlines.
- **Local-first.** Everything lives in your browser storage. No account, no server, no tracking.

<details>
<summary><b>Keyboard shortcuts</b></summary>

| Action | Shortcut |
|---|---|
| Child node | `Tab` |
| Sibling node | `Enter` |
| Edit text | start typing |
| Secondary line (while editing) | `Tab` or `Shift` `Enter` |
| Delete node | `Del` |
| Copy selected branches | `⌘` `C` |
| Paste on canvas | `⌘` `V` |
| Move between nodes | `←` `↑` `→` `↓` |
| Collapse / expand branch | `⌥` `←` / `⌥` `→` |
| Search | `⌘` `F` |
| Pan / zoom | `Space` drag / `⌘` wheel |
| Undo / redo | `⌘` `Z` / `⇧` `⌘` `Z` |
| Toggle theme | `⇧` `⌘` `L` |
| All shortcuts | `?` |

On Windows and Linux use `Ctrl` instead of `⌘` and `Alt` instead of `⌥`.
</details>

## Getting started

Requires Node.js 24 or later.

```bash
git clone https://github.com/alardus/mindspace.git
cd mindspace
npm install
npm run dev
```

Then open the URL printed in the terminal.

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm test` | Run tests |

The app version and repository URL come from `package.json` and appear in the app menu; "What's new" links to the GitHub release `v<version>`.

## Where your data lives

Maps are stored in your browser on this device only: the map library in `localStorage` (`mindspace-library-v1`) and images in IndexedDB (`mindspace-assets-v1`). Clearing site data removes them, so export a backup from **Export → Mindspace file** if a map matters to you. Nothing is sent to any server.

## Contributing

Issues and pull requests are welcome.

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Fork, create a branch, and keep commits focused.
3. Run `npm test` and `npm run build` before opening a PR.
4. For UI changes, include a screenshot in both light and dark themes.

Where things are:

- `src/App.vue`: the app UI: canvas, toolbars, inspector, menus, and dialogs.
- `src/model.js`: the map model: normalization, layout, palettes, OPML/Markdown, and the welcome map.
- `src/assets.js`, `src/archive.js`: local image storage and `.mindmap` archives.
- `src/shortcuts.js`: the shortcut registry behind the key handlers and the help dialog.
- `src/style.css`: styles and theme tokens.
- `test/`: unit tests.

## License

[MIT](LICENSE) © Alexander Bykov
