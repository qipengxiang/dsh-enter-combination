/**
 * Which chord sends, which chord breaks the line.
 *
 * Both chords are shipped internal wiring: the composer's own keymap turns Enter into a submit and
 * Shift+Enter into a line break, and neither is a slot. So this half intercepts keydown in the
 * capture phase before the composer sees it, then replays the shipped path: the send chord calls the
 * session's public submit action, the newline chord re-dispatches Shift+Enter on the composer.
 *
 * The mapping is per browser profile: localStorage, because only this page's composer reads it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-enter-combination',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const STORE = 'dsh-enter-combination';
    const MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent ?? '');
    const COMPOSER = '[data-composer-input]';
    // Keys that are only modifiers: they can be held for a chord but never be the chord's key.
    const MODIFIER = /^(?:Control|Shift|Alt|Meta)(?:Left|Right)$/;
    const MODIFIER_ONLY = new Set(['CapsLock', 'AltGraph', 'Fn', 'FnLock', 'OS', 'Hyper', 'Super']);
    const isModifier = (code) => typeof code === 'string' && (MODIFIER.test(code) || MODIFIER_ONLY.has(code));

    const DEFAULTS = Object.freeze({
      send: Object.freeze({ code: 'Enter', ctrl: false, meta: false, alt: false, shift: false }),
      newline: Object.freeze({ code: 'Enter', ctrl: !MAC, meta: MAC, alt: false, shift: false }),
    });

    const NAMES = {
      Enter: 'Enter',
      NumpadEnter: 'Enter',
      Space: 'Space',
      Escape: 'Esc',
      Tab: 'Tab',
      Backspace: '⌫',
      Delete: 'Del',
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
      Home: 'Home',
      End: 'End',
      PageUp: 'PgUp',
      PageDown: 'PgDn',
      Comma: ',',
      Period: '.',
      Slash: '/',
      Semicolon: ';',
      Quote: "'",
      BracketLeft: '[',
      BracketRight: ']',
      Backquote: '`',
      Backslash: '\\',
      Minus: '-',
      Equal: '=',
    };

    /** `code` → the short name people read on a keycap. */
    function keyName(code) {
      if (typeof code !== 'string' || code === '') return '?';
      if (NAMES[code] !== undefined) return NAMES[code];
      if (code.startsWith('Key')) return code.slice(3);
      if (code.startsWith('Digit')) return code.slice(5);
      if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
      return code;
    }

    /** One chord as a keycap label: `⌘Enter` on macOS, `Ctrl+Enter` elsewhere. */
    function labelOf(chord) {
      const parts = [];
      if (chord.ctrl) parts.push(MAC ? '⌃' : 'Ctrl');
      if (chord.meta) parts.push(MAC ? '⌘' : 'Win');
      if (chord.alt) parts.push(MAC ? '⌥' : 'Alt');
      if (chord.shift) parts.push(MAC ? '⇧' : 'Shift');
      parts.push(keyName(chord.code));
      return MAC ? parts.join('') : parts.join('+');
    }

    /** The chord a keyboard event carries, in the form the settings store. */
    function chordOf(event) {
      return {
        code: event.code,
        ctrl: event.ctrlKey === true,
        meta: event.metaKey === true,
        alt: event.altKey === true,
        shift: event.shiftKey === true,
      };
    }

    function sameChord(chord, other) {
      return chord !== undefined && other !== undefined && chord.code === other.code &&
        chord.ctrl === other.ctrl && chord.meta === other.meta && chord.alt === other.alt && chord.shift === other.shift;
    }

    /** A stored chord, or undefined for anything this page must not trust. */
    function clean(chord) {
      if (chord === null || typeof chord !== 'object' || typeof chord.code !== 'string' || chord.code === '') return undefined;
      return { code: chord.code, ctrl: chord.ctrl === true, meta: chord.meta === true, alt: chord.alt === true, shift: chord.shift === true };
    }

    function sanitize(raw) {
      return {
        send: clean(raw?.send) ?? { ...DEFAULTS.send },
        newline: clean(raw?.newline) ?? { ...DEFAULTS.newline },
      };
    }

    function read() {
      try {
        return sanitize(JSON.parse(localStorage.getItem(STORE) ?? 'null'));
      } catch (_error) {
        return sanitize(null);
      }
    }

    let prefs = read();
    // Set while the settings page waits for the next chord; it owns the keyboard until then.
    let capturing = null;
    const watchers = new Set();

    function write(next) {
      prefs = next;
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch (_error) {
        // A profile that refuses storage keeps the mapping for this page only.
      }
      for (const watcher of watchers) watcher();
    }

    /**
     * Submit through the same transaction the Send button uses; the session decides what it means.
     * @returns whether a session took the message, so a composer without one keeps its own Enter.
     */
    function send(ctx, editor) {
      try {
        const host = editor.closest('[data-conversation-session]');
        const sessionId = host === null ? undefined : host.getAttribute('data-conversation-session');
        if (sessionId === null || sessionId === undefined) return false;
        const actx = ctx.sessions.scope(sessionId);
        const actions = actx?.get('conversation')?.input?.for(actx)?.actions;
        if (typeof actions?.submit !== 'function') return false;
        actions.submit();
        return true;
      } catch (_error) {
        // A scope that is no longer retained has nothing to send to.
        return false;
      }
    }

    /** The composer already reads Shift+Enter as a line break: replay that chord instead of the pressed one. */
    function lineBreak(editor) {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }

    function listen(ctx) {
      const onKeyDown = (event) => {
        // The replayed line break is untrusted: never let it loop back through this handler.
        if (event.isTrusted === false) return;
        if (capturing !== null) {
          if (capturing(event) === true) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        // A composing IME owns Enter; the composer must keep seeing it.
        if (event.isComposing === true || event.keyCode === 229) return;
        const target = event.target;
        const editor = target !== null && typeof target === 'object' && typeof target.closest === 'function'
          ? target.closest(COMPOSER)
          : null;
        if (editor === null || editor === undefined) return;
        const chord = chordOf(event);
        if (sameChord(chord, prefs.send)) {
          // A held send key must not queue a burst, and a composer without a session keeps its own Enter.
          if (event.repeat === true || send(ctx, editor) === true) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        if (sameChord(chord, prefs.newline)) {
          event.preventDefault();
          event.stopPropagation();
          lineBreak(editor);
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => document.removeEventListener('keydown', onKeyDown, true);
    }

    const CSS = `
.dec-page { display: flex; flex-direction: column; gap: 12px; max-width: 660px; padding-bottom: 24px; }
.dec-heading { margin: 0; font-size: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dec-note { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); margin: 0; }
.dec-list { display: flex; flex-direction: column; }
.dec-row { display: flex; align-items: center; gap: 16px; padding: 13px 0; }
.dec-row + .dec-row { border-top: 1px solid var(--dsw-alias-border-l1); }
.dec-row-armed .dec-title { color: var(--dsw-alias-brand-primary); }
.dec-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.dec-title { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dec-desc { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dec-key { flex: none; min-width: 96px; padding: 6px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 12px; font-family: inherit; cursor: pointer; transition: border-color 120ms ease, color 120ms ease; }
.dec-key:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dec-key:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dec-key-armed { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dec-error { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-error-primary); margin: 0; }
@media (prefers-reduced-motion: reduce) { .dec-key { transition: none; } }
`;

    function Page() {
      const [armed, setArmed] = React.useState(undefined);
      const [error, setError] = React.useState(undefined);
      const [, bump] = React.useReducer((count) => count + 1, 0);

      React.useEffect(() => {
        watchers.add(bump);
        return () => {
          watchers.delete(bump);
        };
      }, []);

      React.useEffect(() => {
        if (armed === undefined) {
          capturing = null;
          return undefined;
        }
        // The recording owns the keyboard: a held modifier keeps waiting, the first real key lands.
        capturing = (event) => {
          if (isModifier(event.code)) return false;
          if (event.code === 'Escape') {
            setArmed(undefined);
            return true;
          }
          const chord = chordOf(event);
          if (sameChord(chord, armed === 'send' ? prefs.newline : prefs.send)) {
            setError(`和${armed === 'send' ? '换行' : '发送'}键相同了，再录一个别的键`);
            setArmed(undefined);
            return true;
          }
          setError(undefined);
          write({ ...prefs, [armed]: chord });
          setArmed(undefined);
          return true;
        };
        return () => {
          capturing = null;
        };
      }, [armed]);

      const row = (slot, title, desc) => h(
        'div',
        { className: `dec-row${armed === slot ? ' dec-row-armed' : ''}` },
        h('div', { className: 'dec-text' },
          h('span', { className: 'dec-title' }, title),
          h('span', { className: 'dec-desc' }, desc)),
        h('button', {
          type: 'button',
          className: `dec-key${armed === slot ? ' dec-key-armed' : ''}`,
          'aria-label': `${title}：${labelOf(prefs[slot])}，点击后按下新的组合键`,
          onClick: () => {
            setError(undefined);
            setArmed(armed === slot ? undefined : slot);
          },
          onBlur: () => {
            if (armed === slot) setArmed(undefined);
          },
        }, armed === slot ? '按下新的按键…' : labelOf(prefs[slot])),
      );

      return h('div', { className: 'dec-page' },
        h('style', {}, CSS),
        h('h2', { className: 'dec-heading' }, '发送按键'),
        h('p', { className: 'dec-note' }, '发送键按下后直接把消息发给 AI；换行键只在输入框里换到下一行，方便格式化输入。点右侧的按键重新录制：按下想用的组合就生效，Esc 取消。'),
        h('div', { className: 'dec-list' },
          row('send', '发送', '在输入框里按下这个键，消息直接发出'),
          row('newline', '换行', '在输入框里按下这个键，光标换到下一行')),
        error === undefined ? null : h('p', { className: 'dec-error' }, error));
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        ctx.effect(() => listen(ctx), 'dsh-enter-combination: send and newline chords');
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-enter-combination',
          order: 140,
          label: () => '发送按键',
        }, Page));
      },
    };
  },
});
