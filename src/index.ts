import {
  EditorSelection,
  type Extension,
  Prec,
  type SelectionRange,
  type StateCommand,
  type Text,
} from '@codemirror/state';
import { EditorView, keymap, type MouseSelectionStyle } from '@codemirror/view';

/**
 * CodeMirror's group commands (cursorGroupLeft etc.) assume a language that separates words with
 * spaces, and treat a run of characters of the same category (word, space, other) as one group.
 * Japanese and Chinese do not put spaces between words, and every Han character and kana counts as
 * "word", so those commands jump all the way to the next space or other character. To stop at
 * their word boundaries like Chrome's textarea does, the boundaries come from Intl.Segmenter.
 *
 * Where Intl.Segmenter is missing, or construction fails because some browser extension broke it,
 * every command returns false and leaves the key to defaultKeymap's cursorGroupLeft etc. Without
 * catching the failure, importing this module would throw and take the whole editor down.
 */
const segmenter = (() => {
  try {
    return new Intl.Segmenter(undefined, { granularity: 'word' });
  } catch {
    return null;
  }
})();

type Unit = { from: number; to: number; kind: 'word' | 'symbol' | 'space' | 'separator' };

/**
 * Returns the unit of motion that contains index i of the segmented line, or undefined when i is
 * outside the line.
 *
 * Intl.Segmenter splits symbols into single characters, but Chrome's textarea skips "!!!" or "。」"
 * at once, so consecutive symbols are merged into one unit.
 */
function unitAt(segments: Intl.Segments, i: number): Unit | undefined {
  const data = segments.containing(i);
  if (!data) return undefined;
  const kind = kindOf(data.segment);
  let from = data.index;
  let to = data.index + data.segment.length;
  if (kind === 'symbol') {
    for (let prev; (prev = segments.containing(from - 1)) && kindOf(prev.segment) === 'symbol'; ) {
      from = prev.index;
    }
    for (let next; (next = segments.containing(to)) && kindOf(next.segment) === 'symbol'; ) {
      to = next.index + next.segment.length;
    }
  }
  return { from, to, kind };
}

/**
 * Whether a segment is a word is decided by its content, not by isWordLike. Firefox's
 * Intl.Segmenter returns isWordLike: false for some Japanese words (icu_segmenter before 2.3.0),
 * which would merge them with the symbols around them.
 *
 * Only the spaces that separate words (space, tab, no-break space) are skipped together with the
 * next word. Other whitespace such as the ideographic space (U+3000) is spacing within text, and
 * Chrome's and Firefox's textareas stop on both sides of it. Where these spaces are mixed with
 * separators or followed by symbols, the browsers are inconsistent, and this does not follow
 * them there.
 */
function kindOf(segment: string): Unit['kind'] {
  return /[\p{L}\p{N}]/u.test(segment)
    ? 'word'
    : /^[ \t\xa0]+$/.test(segment)
      ? 'separator'
      : /^\s+$/.test(segment)
        ? 'space'
        : 'symbol';
}

/** Returns the position one word away from pos, or null when Intl.Segmenter is unavailable. */
export function wordBoundary(doc: Text, pos: number, forward: boolean): number | null {
  if (!segmenter) return null;
  const line = doc.lineAt(pos);
  const offset = pos - line.from;
  // At a line edge, step over the line break as cursorGroupLeft does. Chrome's textarea does not
  // move backward from a line start at all, which would leave no way back to the previous line by
  // word.
  if (forward ? offset === line.length : offset === 0) {
    return forward ? Math.min(pos + 1, doc.length) : Math.max(pos - 1, 0);
  }

  const segments = segmenter.segment(line.text);
  let unit = unitAt(segments, forward ? offset : offset - 1);
  while (unit?.kind === 'separator') unit = unitAt(segments, forward ? unit.to : unit.from - 1);
  if (!unit) return forward ? line.to : line.from;
  return line.from + (forward ? unit.to : unit.from);
}

/**
 * Returns the unit of motion at pos, or null when Intl.Segmenter is unavailable. Between two units,
 * bias picks the one before (-1) or after (1) pos.
 */
export function wordAt(doc: Text, pos: number, bias: -1 | 1): SelectionRange | null {
  if (!segmenter) return null;
  const line = doc.lineAt(pos);
  if (line.length === 0) return EditorSelection.cursor(pos);
  const offset = pos - line.from;
  // At a line edge, the side toward the line break has no unit, and unitAt() below would return
  // undefined.
  if (offset === 0) bias = 1;
  else if (offset === line.length) bias = -1;
  const unit = unitAt(segmenter.segment(line.text), bias < 0 ? offset - 1 : offset)!;
  return EditorSelection.undirectionalRange(line.from + unit.from, line.from + unit.to);
}

/**
 * Does what CodeMirror's basicMouseSelection does on double-click, with wordAt in place of
 * groupAt.
 */
function wordMouseSelection(view: EditorView, event: MouseEvent): MouseSelectionStyle | null {
  if (!segmenter || event.button !== 0 || event.detail !== 2) return null;
  const posAt = (event: MouseEvent) =>
    view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
  const rangeAt = ({ pos, assoc }: { pos: number; assoc: -1 | 1 }) =>
    wordAt(view.state.doc, pos, assoc)!;
  const start = posAt(event);
  let startSel = view.state.selection;
  return {
    update(update) {
      if (update.docChanged) {
        start.pos = update.changes.mapPos(start.pos);
        startSel = startSel.map(update.changes);
      }
    },
    get(curEvent, extend, multiple) {
      const cur = posAt(curEvent);
      let range = rangeAt(cur);
      if (start.pos !== cur.pos && !extend) {
        const startRange = rangeAt(start);
        const from = Math.min(startRange.from, range.from);
        const to = Math.max(startRange.to, range.to);
        range = from < range.from ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
      }
      if (extend) return startSel.replaceRange(startSel.main.extend(range.from, range.to));
      if (multiple) return startSel.addRange(range);
      return EditorSelection.create([range]);
    },
  };
}

type CommandTarget = Parameters<StateCommand>[0];

function moveByWord({ state, dispatch }: CommandTarget, forward: boolean, extend: boolean): boolean {
  if (!segmenter) return false;
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) => {
      if (!extend && !range.empty) return EditorSelection.cursor(forward ? range.to : range.from);
      const head = wordBoundary(state.doc, range.head, forward) ?? range.head;
      return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
    }),
    state.selection.mainIndex,
  );
  if (selection.eq(state.selection)) return false;
  dispatch(state.update({ selection, scrollIntoView: true, userEvent: 'select' }));
  return true;
}

function deleteByWord({ state, dispatch }: CommandTarget, forward: boolean): boolean {
  if (!segmenter || state.readOnly) return false;
  const spec = state.changeByRange((range) => {
    if (!range.empty) {
      return {
        changes: { from: range.from, to: range.to },
        range: EditorSelection.cursor(range.from),
      };
    }
    const target = wordBoundary(state.doc, range.head, forward) ?? range.head;
    const from = Math.min(range.head, target);
    const to = Math.max(range.head, target);
    return from === to ? { range } : { changes: { from, to }, range: EditorSelection.cursor(from) };
  });
  if (spec.changes.empty) return false;
  dispatch(
    state.update(spec, {
      scrollIntoView: true,
      userEvent: forward ? 'delete.forward' : 'delete.backward',
    }),
  );
  return true;
}

export const cursorWordLeft: StateCommand = (target) => moveByWord(target, false, false);
export const cursorWordRight: StateCommand = (target) => moveByWord(target, true, false);
export const selectWordLeft: StateCommand = (target) => moveByWord(target, false, true);
export const selectWordRight: StateCommand = (target) => moveByWord(target, true, true);
export const deleteWordBackward: StateCommand = (target) => deleteByWord(target, false);
export const deleteWordForward: StateCommand = (target) => deleteByWord(target, true);

/**
 * Binds the commands to the keys defaultKeymap uses for its group commands, and selects by word on
 * double-click. Prec.high makes the keys run first wherever this is placed, as defaultKeymap's
 * group commands would otherwise handle them before. Prec.lowest leaves the double-click to any
 * other mouseSelectionStyle such as rectangularSelection, wherever this is placed.
 */
export function cjkWordMotion(): Extension {
  return [
    Prec.high(
      keymap.of([
        { key: 'Mod-ArrowLeft', mac: 'Alt-ArrowLeft', run: cursorWordLeft, shift: selectWordLeft, preventDefault: true },
        { key: 'Mod-ArrowRight', mac: 'Alt-ArrowRight', run: cursorWordRight, shift: selectWordRight, preventDefault: true },
        { key: 'Mod-Backspace', mac: 'Alt-Backspace', run: deleteWordBackward, preventDefault: true },
        { key: 'Mod-Delete', mac: 'Alt-Delete', run: deleteWordForward, preventDefault: true },
        { mac: 'Ctrl-Alt-h', run: deleteWordBackward },
      ]),
    ),
    Prec.lowest(EditorView.mouseSelectionStyle.of(wordMouseSelection)),
  ];
}
