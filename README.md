# dsh-enter-combination

[中文说明](README.zh.md)

Pick which key sends a message and which key breaks the line in the DeepSeek Harness composer.
Enter sends and ⌘/Ctrl+Enter breaks the line out of the box; either one can be re-recorded.

## Settings

设置 → 发送按键 (one section of its own in the settings drawer).

| Row | Default | What the key does in the composer |
| --- | --- | --- |
| 发送 | `Enter` | sends the draft to the AI |
| 换行 | `⌘Enter` on macOS, `Ctrl+Enter` elsewhere | moves the caret to the next line, without sending |

Click a key button and press the combination you want: the next real key is recorded together with the
modifiers held at that moment, and the row shows it right away. `Esc` cancels, clicking the button
again cancels too, and a chord the other row already owns is refused with a one-line hint instead of
silently shadowing it.

## How it hooks the composer

Both chords are shipped internal wiring — the composer's own keymap turns Enter into a submit and
Shift+Enter into a line break, and neither is exposed as a slot. So this plugin listens for `keydown`
on `document` in the capture phase, before the composer sees it, and then replays the shipped path:

- **send** → the session's public submit action (`conversation.input.for(scope).actions.submit()`),
  the same transaction the Send button runs. Two guards: a held key does not queue a burst of sends,
  and a composer with no session behind it is left alone so its own Enter still works.
- **newline** → re-dispatches a `Shift+Enter` keydown on the composer's contenteditable, which is
  exactly the chord the editor already treats as a line break. The replay is untrusted, so the
  listener ignores it.

A composing IME keeps its Enter: while the input method is composing, both chords are left to the
composer.

## Storage

`localStorage['dsh-enter-combination']`, per browser profile. There is no host half to persist: only
this page's composer reads the mapping, and the mapping is two chords. The cost is that the same
profile opened on another machine starts from the defaults again.

## Install

Needs a DeepSeek Harness build that loads plugin bundles (`dsh.bundle` in `package.json`).

```
dsh plugin --profile desktop add link:/absolute/path/to/dsh-enter-combination
```

That links the folder into the active profile (`link:` in the profile `package.json`) and adds the
bundle to `dsh.profile.bundles`, so the profile tracks this source tree instead of a copy.

`client.js` is re-read on every page load, but the plugin itself only mounts when Harness boots:
restart Harness (quit and reopen the app) to see the section for the first time. Later edits to
`client.js` only need a page refresh.

## Test

```
npm test
```

`test/self-check.mjs` loads `client.js` the way the module loader does, stubs the DOM, and asserts the
interception (defaults, the shift-enter replay, unrelated inputs, IME, held key, no session) and the
recorder (recording a chord, cancelling with Esc, refusing the chord the other row owns, unusable
storage falling back to the defaults).

## Limits

- The chords are matched on `event.code` plus the four modifier flags, so they follow the physical
  key rather than the layout's character: `⌘Enter` stays `⌘Enter` on a Dvorak layout, and two keys
  that produce the same character are still two different chords.
- Characters that come from the layout (e.g. `⌘↩` vs `⌘Enter`) are the same chord; the row shows the
  name of the code that was recorded.
- While a row is recording, the next chord anywhere on the page goes to the recorder — not just keys
  pressed inside the composer.
- The mapping is a browser-profile preference: it does not travel with the session, and another
  browser/OS profile starts at the defaults.
