# code-hopper

Lightweight multi-language symbol navigation for Pulsar.

Code Hopper is built for quick code reading during terminal-first AI coding workflows. It uses `ctags` for symbol indexing and `rg` as a fast fallback search layer, then shows ranked candidates when a jump is ambiguous.

## Features

- Jump from the symbol under cursor.
- Trigger jumps with command, shortcut, or `Alt + left click`.
- Build a ctags symbol index in the background.
- Fall back to `rg` when the index is missing or ctags is unavailable.
- Show a filterable candidate list when multiple targets are found.
- Open the selected file at the candidate line and column.
- Jump back to the previous source location.
- Search all indexed workspace symbols.
- Find references with ripgrep.
- Rank candidates with context from open files, git modified files, language, path, and source root proximity.
- Kotlin files (`.kt`, `.kts`) are recognized in ctags and rg fallback flows.
- Rust, Shell, HTML, CSS, Go, and Dart are recognized in ctags and rg fallback flows.

## Commands

- `code-hopper:jump-to-symbol`
- `code-hopper:jump-back`
- `code-hopper:refresh-index`
- `code-hopper:search-symbol`
- `code-hopper:find-references`

After Code Hopper is active, the status bar item can also be clicked to refresh the index.

## Default keys

- `Alt+G Alt+D`: jump to symbol
- `Alt+G Alt+B`: jump back
- `Alt+G Alt+S`: search workspace symbols
- `Alt+G Alt+R`: find references

## Tools

Install Universal Ctags for best indexing behavior. The BSD ctags bundled with Xcode does not support the required multi-language options.

`rg` is used for fallback search and is recommended even when ctags is available.

Generated index files are stored under Pulsar's user config directory by default. Set `code-hopper.indexDirectory` to use a custom location.

Set `code-hopper.sourceRoots` to limit indexing to project-relative directories. When empty, Code Hopper auto-detects common roots like `src`, `lib`, `app`, `cmd`, and `internal`.
