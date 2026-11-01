import { describe, expect, it } from 'vitest';

import { EditorSelection, EditorState, type Extension, type StateCommand } from '@codemirror/state';

import {
  cursorWordLeft,
  cursorWordRight,
  deleteWordBackward,
  deleteWordForward,
  selectWordLeft,
  selectWordRight,
  wordBoundary,
} from './index.js';

/**
 * Creates a state from a doc with `|` at the cursor. A selection is enclosed in `<` and `>`, with
 * `|` at the end where the cursor is: `<|foo>` or `<foo|>`.
 */
function fromMarkedDoc(doc: string, extensions: Extension = []) {
  const start = doc.indexOf('<');
  const text = doc.replace(/[|<>]/g, '');
  if (start < 0) {
    return EditorState.create({ doc: text, selection: EditorSelection.single(doc.indexOf('|')), extensions });
  }
  // `<` and `|` come before `>`.
  const end = doc.indexOf('>') - 2;
  const selection =
    doc[start + 1] === '|' ? EditorSelection.single(end, start) : EditorSelection.single(start, end);
  return EditorState.create({ doc: text, selection, extensions });
}

/** Writes the doc with the selection marked as in fromMarkedDoc. */
function toMarkedDoc(state: EditorState) {
  const { from, to, head, empty } = state.selection.main;
  const doc = state.doc.toString();
  if (empty) return doc.slice(0, from) + '|' + doc.slice(from);
  const selected = head === from ? '|' + doc.slice(from, to) : doc.slice(from, to) + '|';
  return doc.slice(0, from) + '<' + selected + '>' + doc.slice(to);
}

function cmd(state: EditorState, command: StateCommand) {
  command({
    state,
    dispatch(tr) {
      state = tr.state;
    },
  });
  return state;
}

/** Moves the cursor once with wordBoundary. */
function move(state: EditorState, forward: boolean) {
  const { head } = state.selection.main;
  const next = wordBoundary(state.doc, head, forward) ?? head;
  return state.update({ selection: { anchor: next } }).state;
}

/** Moves from one end of the doc to the other with wordBoundary and marks every stop with `|`. */
function stops(doc: string, forward: boolean) {
  const { doc: text } = EditorState.create({ doc });
  const positions = new Set<number>();
  let pos = forward ? 0 : doc.length;
  for (;;) {
    positions.add(pos);
    const next = wordBoundary(text, pos, forward) ?? pos;
    if (next === pos) break;
    pos = next;
  }
  return Array.from(
    { length: doc.length + 1 },
    (_, i) => (positions.has(i) ? '|' : '') + doc.slice(i, i + 1),
  ).join('');
}

describe('wordBoundary', () => {
  function testForward(from: string, to: string) {
    expect(toMarkedDoc(move(fromMarkedDoc(from), true))).toBe(to);
  }

  function testBackward(from: string, to: string) {
    expect(toMarkedDoc(move(fromMarkedDoc(from), false))).toBe(to);
  }

  /**
   * `forward` and `backward` mark every stop with `|`, and the doc is them without `|`. With only
   * `forward`, moving backward stops at the same positions.
   */
  function testStops(forward: string, backward = forward) {
    const doc = forward.replaceAll('|', '');
    expect(stops(doc, true)).toBe(forward);
    expect(stops(doc, false)).toBe(backward);
  }

  describe('when the position is within a line', () => {
    // The stops of whole sentences are where Option+←→ stops in Chrome 156's textarea.
    it('stops at each word in a sentence', () => {
      testStops('|日本語|の|文章|は|単語|の|間|に|空白|を|入れ|ない|。|');
    });

    it('stops before and after the period between sentences', () => {
      testStops('|吾輩|は|猫|で|ある|。|名前|は|まだ|無い|。|');
    });

    it('stops before and after a space that does not separate words', () => {
      testStops('|古池|や|　|蛙|飛び込む|　|水|の|音|');
    });

    it('moves over consecutive punctuation at once and over a space with the word beyond it', () => {
      // A space that separates words is skipped together with the word beyond it, so moving
      // forward stops after " and", and moving backward stops before "and ".
      testStops(
        '|“|Curiouser| and| curiouser|!”| cried| Alice|',
        '|“|Curiouser |and |curiouser|!” |cried |Alice|',
      );
    });

    it('moves to the end of the word from its middle', () => {
      testForward('fo|o bar', 'foo| bar');
      testBackward('foo b|ar', 'foo |bar');
    });

    it('moves to the line edge when only spaces remain', () => {
      testForward('foo|  \nbar', 'foo  |\nbar');
      testBackward('foo\n  |bar', 'foo\n|  bar');
    });
  });

  describe('when the position is at the edge of a line', () => {
    it('moves over the line break', () => {
      testForward('foo|\nbar', 'foo\n|bar');
      testBackward('foo\n|bar', 'foo|\nbar');
    });
  });

  describe('when the position is at the edge of the document', () => {
    it('does not move', () => {
      testForward('foo|', 'foo|');
      testBackward('|foo', '|foo');
    });
  });
});

describe('cursorWordLeft', () => {
  function test(from: string, to: string) {
    expect(toMarkedDoc(cmd(fromMarkedDoc(from), cursorWordLeft))).toBe(to);
  }

  describe('when nothing is selected', () => {
    it('moves the cursor to the start of the previous word', () => {
      test('日本語の|文章', '日本語|の文章');
    });

    describe('when the cursor is at the start of the document', () => {
      it('does nothing', () => {
        test('|日本語の文章', '|日本語の文章');
      });
    });
  });

  describe('when text is selected', () => {
    it('collapses the selection to its start', () => {
      test('日本<語の|>文章', '日本|語の文章');
    });
  });
});

describe('cursorWordRight', () => {
  function test(from: string, to: string) {
    expect(toMarkedDoc(cmd(fromMarkedDoc(from), cursorWordRight))).toBe(to);
  }

  describe('when nothing is selected', () => {
    it('moves the cursor to the end of the next word', () => {
      test('日本語|の文章', '日本語の|文章');
    });

    describe('when the cursor is at the end of the document', () => {
      it('does nothing', () => {
        test('日本語の文章|', '日本語の文章|');
      });
    });
  });

  describe('when text is selected', () => {
    it('collapses the selection to its end', () => {
      test('日本<|語の>文章', '日本語の|文章');
    });
  });
});

describe('selectWordLeft', () => {
  function test(from: string, to: string) {
    expect(toMarkedDoc(cmd(fromMarkedDoc(from), selectWordLeft))).toBe(to);
  }

  describe('when nothing is selected', () => {
    it('selects up to the start of the previous word', () => {
      test('日本語の|文章', '日本語<|の>文章');
    });
  });

  describe('when text is selected', () => {
    it('moves the cursor end of the selection to the start of the previous word', () => {
      test('日本語の<|文章>', '日本語<|の文章>');
    });
  });
});

describe('selectWordRight', () => {
  function test(from: string, to: string) {
    expect(toMarkedDoc(cmd(fromMarkedDoc(from), selectWordRight))).toBe(to);
  }

  describe('when nothing is selected', () => {
    it('selects up to the end of the next word', () => {
      test('日本語|の文章', '日本語<の|>文章');
    });
  });

  describe('when text is selected', () => {
    it('moves the cursor end of the selection to the end of the next word', () => {
      test('<日本|>語の文章', '<日本語|>の文章');
    });
  });
});

describe('deleteWordBackward', () => {
  function test(from: string, to: string, extensions: Extension = []) {
    expect(toMarkedDoc(cmd(fromMarkedDoc(from, extensions), deleteWordBackward))).toBe(to);
  }

  describe('when the editor is editable', () => {
    describe('when nothing is selected', () => {
      it('deletes the word before the cursor', () => {
        test('日本語の文章|', '日本語の|');
      });

      describe('when the cursor is at the start of the document', () => {
        it('does nothing', () => {
          test('|日本語の文章', '|日本語の文章');
        });
      });
    });

    describe('when text is selected', () => {
      it('deletes the selection', () => {
        test('日本<語の|>文章', '日本|文章');
      });
    });
  });

  describe('when the editor is read-only', () => {
    it('does nothing', () => {
      test('日本語の文章|', '日本語の文章|', EditorState.readOnly.of(true));
    });
  });
});

describe('deleteWordForward', () => {
  function test(from: string, to: string) {
    expect(toMarkedDoc(cmd(fromMarkedDoc(from), deleteWordForward))).toBe(to);
  }

  describe('when nothing is selected', () => {
    it('deletes the word after the cursor', () => {
      test('|日本語の文章', '|の文章');
    });

    describe('when the cursor is at the end of the document', () => {
      it('does nothing', () => {
        test('日本語の文章|', '日本語の文章|');
      });
    });
  });
});
