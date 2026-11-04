## Unreleased

### New features

`cjkWordMotion()` now makes double-click select the word between the same boundaries as the commands. This requires `@codemirror/state` 6.7.0 and `@codemirror/view` 6.39.0.

### Bug fixes

`cjkWordMotion()` now also binds Ctrl-Alt-h on macOS, which `defaultKeymap` binds to `deleteGroupBackward`.

Improve the performance of the commands and double-click on long lines.

## 1.0.0 (2026-11-02)

Initial release.
