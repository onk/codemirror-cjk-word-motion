# @onk/codemirror-cjk-word-motion

CodeMirror commands to move and delete by word in CJK text.

CodeMirror's group commands (`cursorGroupLeft`, `deleteGroupBackward` and so on) treat every Han character and kana as belonging to a "word" group. Japanese and Chinese do not put spaces between words, so these commands jump all the way to the next space or symbol.

In 日本語の文章は単語の間に空白を入れない。 ("Japanese text does not put spaces between words."), Ctrl+→ (Option+→ on macOS) stops at:

```
|日本語の文章は単語の間に空白を入れない|。|
```

The commands in this package find word boundaries with [`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) and behave similarly to Chrome's `<textarea>`:

```
|日本語|の|文章|は|単語|の|間|に|空白|を|入れ|ない|。|
```

CodeMirror keeps its group commands this way on purpose ([codemirror/dev#1201](https://code.haverbeke.berlin/codemirror/dev/issues/1201)).

## Install

```sh
npm install @onk/codemirror-cjk-word-motion
```

## Usage

```ts
import { basicSetup, EditorView } from 'codemirror';
import { cjkWordMotion } from '@onk/codemirror-cjk-word-motion';

new EditorView({ parent: document.body, extensions: [basicSetup, cjkWordMotion()] });
```

## API

### `cjkWordMotion()`

Returns an extension that binds the commands below to these keys. It takes them over from the group commands in `defaultKeymap` (included in `basicSetup`).

- Ctrl+←/→ (Option+←/→ on macOS): `cursorWordLeft` / `cursorWordRight`
- Shift+Ctrl+←/→ (Shift+Option+←/→ on macOS): `selectWordLeft` / `selectWordRight`
- Ctrl+Backspace/Delete (Option+Backspace/Delete on macOS): `deleteWordBackward` / `deleteWordForward`
- Ctrl+Option+H on macOS: `deleteWordBackward`

### Commands

| Command | Description |
|---|---|
| `cursorWordLeft` / `cursorWordRight` | Moves the cursor to the start of the previous word / the end of the next word. A selection is collapsed to its start / end. |
| `selectWordLeft` / `selectWordRight` | Moves the head of the selection the same way, keeping its anchor. |
| `deleteWordBackward` / `deleteWordForward` | Deletes up to the start of the previous word / the end of the next word, or the selection if any. |

Where `Intl.Segmenter` is unavailable, the commands return `false` and leave the key to the next keymap, so `defaultKeymap`'s group commands still work.

## How it stops

Measured on macOS with Option+→ in Chrome 156 and Firefox 159 (Developer Edition).

```
メロスは激怒した。
  CodeMirror default       |メロスは激怒した|。|
  This package             |メロス|は|激怒|した|。|

  For reference:
  Chrome <textarea>        |メロス|は|激怒|した|。|
  Firefox <textarea>       |メロス|は|激怒|した。|
```

### Differences from Chrome's `<textarea>`

- Firefox's `Intl.Segmenter` uses a different dictionary from Chrome's, so this package splits some words differently in Firefox. 名前はまだ無い is split `|名前|は|まだ|無い|` in Chrome and `|名前|はま|だ|無い|` in Firefox.
- At the start of a line, Chrome's `<textarea>` does not move backward at all. This package moves to the end of the previous line, as CodeMirror's default does.
- This package always stops on both sides of whitespace other than space, tab and no-break space, such as the ideographic space (U+3000). Chrome's `<textarea>` sometimes does not when it is next to a space or followed by a symbol.

## License

ISC
