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
- **Drag to rearrange.** Drop a node or a whole branch onto another node to reattach it.
- **Links across branches.** Hold `Shift` and drag from one node to another to connect ideas outside the tree. A link is a neutral dashed arrow that follows its nodes; it can carry a label, point both ways, or have no arrow.
- **Copy and paste.** Copy complete branches between maps, paste outlines from XMind, Miro, MindNode, or Coggle, or paste plain text as one independent root block.
- **Images.** Paste or drop PNG, JPEG, WebP, or GIF files up to 10 MB onto the canvas, as a block of their own or inside a node.
- **Auto layout.** Branches to the right, on both sides, or as a tree, with smooth or straight lines and adjustable spacing. Turn it off to place nodes by hand.
- **Icon marks.** Ten fixed icons (Important, Question, Done, Idea, and more) to put on a node with `1`–`0`, or to drop on the canvas as a free mark you can move and resize.
- **Canvas text.** Double-click empty canvas space to add a movable text block; resize it from any corner to scale the frame and type together.
- **Branch palettes.** Bright, Calm, or Mono, plus per-branch colors inherited by children.
- **Light and dark themes.** Follows your system or set manually; branch colors adapt to each theme.
- **Import and export.** `.mindmap` files for backups (images included), plus OPML and Markdown outlines.
- **Optional Google Drive backup.** Keep a copy of any map in your own Google Drive, updated a few seconds after each change, and restore it on another device. Off until you connect a map.
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
| Select all blocks | `⌘` `A` |
| Paste on canvas | `⌘` `V` |
| Move between nodes | `←` `↑` `→` `↓` |
| Collapse / expand branch | `⌥` `←` / `⌥` `→` |
| Link two nodes | `⇧` drag from a node |
| Icon set / add or remove an icon | `I` / `1`–`0` |
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

Maps are stored in your browser on this device only: the map library in `localStorage` (`mindspace-library-v1`) and images in IndexedDB (`mindspace-assets-v1`). Clearing site data removes them, so export a backup from **Export → Mindspace file** if a map matters to you, or connect it to Google Drive.

Nothing is sent to any server. The one exception is a map you connect to Google Drive yourself: its `.mindmap` file goes from your browser straight to your own Drive.

## Google Drive backup

Open the maps menu and press **Connect** next to Google Drive (or **⋯ → Save to Google Drive** on any map). Choose a new file in a `Mindspace` folder in your Drive, or an existing `.mindmap` to replace. From then on the file is updated about five seconds after each change. The browser stays the primary store: if Drive is unreachable, editing and local saving go on as usual.

To open a map on another device, use **Import → From Google Drive**. The restored map keeps saving to the same file.

What it is not:

- **Not sync.** A change made elsewhere is never pulled into a map that is already open, and never overwritten silently. If the file in Drive was changed by another device, the backup of that map stops and the menu offers a choice: save to a new file, replace the file in Drive, or pick another file. To get the other version, import it as a separate map.
- **Not collaboration.** Two devices editing the same map at the same moment can both pass the check before either upload lands, and one upload then replaces the other. Mindspace notices on the next change and stops; the lost version may still be in the file's version history in Drive. Use one device at a time.
- **Not a cloud library.** Each map has its own file. Deleting a map here does not delete its file in Drive, and a file removed in Drive only disconnects the map.

Privacy: there is no Mindspace server. Your browser talks to Google directly and asks only for per-file access (`drive.file`) — the app can see the files it created and the ones you pick for it, nothing else in your Drive. The sign-in is kept in memory and is never stored, so Google may ask you to sign in again after a reload or about an hour of work; changes made meanwhile wait on the device and are sent once you do.

## Contributing

Issues and pull requests are welcome.

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Fork, create a branch, and keep commits focused.
3. Run `npm test` and `npm run build` before opening a PR.
4. For UI changes, include a screenshot in both light and dark themes.

Where things are:

- `src/App.vue`: the app UI: canvas, toolbars, inspector, menus, and dialogs.
- `src/model.js`: the map model: normalization, layout, palettes, OPML/Markdown, and the welcome map.
- `src/MarkIcon.vue`: the icon marks drawn on nodes, in the icon set, and on the canvas.
- `src/assets.js`, `src/archive.js`: local image storage and `.mindmap` archives.
- `src/backup.js`, `src/google-drive.js`: Google Drive backup: the decisions (what counts as an edit, when to stop) and the calls to Google.
- `src/shortcuts.js`: the shortcut registry behind the key handlers and the help dialog.
- `src/style.css`: styles and theme tokens.
- `test/`: unit tests.

## License

[MIT](LICENSE) © Alexander Bykov
