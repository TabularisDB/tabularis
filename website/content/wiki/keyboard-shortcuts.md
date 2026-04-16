---
title: "Keyboard Shortcuts"
order: 7
excerpt: "Full reference of keyboard shortcuts available in Tabularis, with instructions for customizing your own bindings."
category: "Customization"
---

# Keyboard Shortcuts

Tabularis ships with a set of keyboard shortcuts for common actions across navigation, the editor, and the data grid. All shortcuts use **Cmd** on macOS and **Ctrl** on Windows/Linux.

---

## Navigation

| Action | macOS | Windows / Linux |
| :--- | :--- | :--- |
| Toggle sidebar | `⌘+B` | `Ctrl+B` |
| Open connections page | `⌘+Shift+C` | `Ctrl+Shift+C` |
| New connection (opens modal) | `⌘+Shift+N` | `Ctrl+Shift+N` |
| Switch to Nth open connection | `⌘+Shift+1–9` | `Ctrl+Shift+1–9` |

---

## Editor

| Action | macOS | Windows / Linux |
| :--- | :--- | :--- |
| Run query | `⌘+F5` | `Ctrl+F5` |
| Run query (from Monaco editor) | `⌘+Enter` | `Ctrl+Enter` |
| New console tab | `⌘+T` | `Ctrl+T` |
| Switch tab (circular) | `Ctrl+Tab` | `Ctrl+Tab` |
| Copy selection | `⌘+C` | `Ctrl+C` |
| Multi-Cursor (click) | `⌘+Click` | `Ctrl+Click` |
| Add next occurrence | `⌘+D` | `Ctrl+D` |
| Select all occurrences | `⌘+Shift+L` | `Ctrl+Shift+L` |
| Cursors at line ends | `⌥+Shift+I` | `Alt+Shift+I` |
| Copy line up | `⌥+Shift+↑` | `Ctrl+Shift+↑` |
| Copy line down | `⌥+Shift+↓` | `Ctrl+Shift+↓` |

---

## Notebook

| Action | macOS | Windows / Linux |
| :--- | :--- | :--- |
| Run All Cells | `⌘+Shift+Enter` | `Ctrl+Shift+Enter` |

---

## Data Grid

| Action | macOS | Windows / Linux |
| :--- | :--- | :--- |
| Next page | `⌘+→` | `Ctrl+→` |
| Previous page | `⌘+←` | `Ctrl+←` |

---

## Customizing Shortcuts

Most shortcuts can be reassigned from **Settings → Keyboard Shortcuts**. Each row in the table shows:

- A **lock icon** for built-in shortcuts that cannot be changed (Monaco editor bindings, browser-level shortcuts).
- An **Edit** button for customizable shortcuts.

Click **Edit** on any customizable row, then press the key combination you want to assign. The recorder captures modifier keys (Cmd/Ctrl, Shift, Alt) plus the final key. Press **Escape** to cancel. Changes are saved immediately to `keybindings.json` in your config directory.

To revert a customized shortcut to its default, click the **↺** (reset) button on its row.

---

## keybindings.json

Tabularis stores your overrides in a JSON file in the OS config directory:

| Platform | Path |
| :--- | :--- |
| macOS | `~/Library/Application Support/tabularis/keybindings.json` |
| Linux | `~/.config/tabularis/keybindings.json` |
| Windows | `%APPDATA%\tabularis\keybindings.json` |

The file is only created when you first customize a shortcut. Its format is a map from shortcut ID to platform-specific `KeyMatch` objects:

```json
{
  "toggle_sidebar": {
    "mac": { "metaKey": true, "key": "k" },
    "win": { "ctrlKey": true, "key": "k" }
  },
  "new_tab": {
    "mac": { "metaKey": true, "key": "n" },
    "win": { "ctrlKey": true, "key": "n" }
  }
}
```

Each `KeyMatch` supports the following fields:

| Field | Type | Description |
| :--- | :--- | :--- |
| `key` | string | The key value (e.g. `"b"`, `"ArrowRight"`, `"F5"`) |
| `ctrlKey` | boolean | Ctrl modifier |
| `metaKey` | boolean | Cmd/Meta modifier |
| `shiftKey` | boolean | Shift modifier |
| `altKey` | boolean | Alt/Option modifier |

You can edit this file manually if you prefer. Tabularis reads it at startup; changes while the app is running take effect after a restart.
