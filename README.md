# code-hopper

Lightweight multi-language symbol navigation for Pulsar.

Code Hopper is built for quick code reading during terminal-first AI coding workflows. It uses `ctags` for symbol indexing and `rg` as a fast fallback search layer, then shows ranked candidates when a jump is ambiguous.

## V0.1 features

- Jump from the symbol under cursor.
- Trigger jumps with command, shortcut, or `Alt + left click`.
- Build a ctags symbol index in the background.
- Fall back to `rg` when the index is missing or ctags is unavailable.
- Show a filterable candidate list when multiple targets are found.
- Open the selected file at the candidate line and column.
- Jump back to the previous source location.
- Kotlin files (`.kt`, `.kts`) are recognized in ctags and rg fallback flows.
- Rust, Shell, HTML, CSS, Go, and Dart are recognized in ctags and rg fallback flows.

## Commands

- `code-hopper:jump-to-symbol`
- `code-hopper:jump-back`
- `code-hopper:refresh-index`

After Code Hopper is active, the status bar item can also be clicked to refresh the index.

## Default keys

- `Alt+G Alt+D`: jump to symbol
- `Alt+G Alt+B`: jump back

## Tools

Install Universal Ctags for best indexing behavior. The BSD ctags bundled with Xcode does not support the required multi-language options.

`rg` is used for fallback search and is recommended even when ctags is available.

Generated index files are stored under Pulsar's user config directory by default. Set `code-hopper.indexDirectory` to use a custom location.
