/**
 * Self-check for the two pieces a browser test cannot reach cheaply: the chords the composer
 * intercepts, and the recorder in the settings page. No framework, no real DOM.
 *
 * Run: node test/self-check.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STORE = 'dsh-enter-combination';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

// macOS user agent: the labels below are the ⌘ family.
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Macintosh)' }, configurable: true });

const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  },
  configurable: true,
});

/** Synthetic events are untrusted, exactly like the replayed line break. */
globalThis.KeyboardEvent = class {
  constructor(type, init = {}) {
    this.type = type;
    this.isTrusted = false;
    Object.assign(this, init);
  }
};

// One composer, one editor inside it, and a document that keeps the capture listener.
const sessionHost = { getAttribute: (name) => (name === 'data-conversation-session' ? 's1' : null) };
const editor = {
  dispatched: [],
  closest: (selector) => (selector === '[data-composer-input]' ? editor : selector === '[data-conversation-session]' ? sessionHost : null),
  dispatchEvent(event) {
    editor.dispatched.push(event);
    return true;
  },
};

let listeners = {};
globalThis.document = {
  addEventListener(name, fn, capture) {
    listeners = { ...listeners, [name]: { fn, capture } };
  },
  removeEventListener() {},
  querySelector: () => null,
};
globalThis.window = { __ModuleLoader__: { load() {} } };
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};

// --- settings page renderer: a hook store that re-renders synchronously ---------------------------
let hooks = [];
let cursor = 0;
let page;
let tree;

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [hooks[index], (value) => {
      hooks[index] = typeof value === 'function' ? value(hooks[index]) : value;
      draw();
    }];
  },
  // Effects re-run on every render: each one only re-points the recorder at the current state.
  useEffect(fn) {
    cursor++;
    fn();
  },
  useReducer(reduce, initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [hooks[index], () => {}];
  },
};

function collect(node, out = []) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (typeof node === 'object') {
    out.push(node);
    collect(node.children, out);
  }
  return out;
}

function draw() {
  cursor = 0;
  tree = page();
  return tree;
}

const label = (button) => button.children.filter((child) => typeof child === 'string').join('');
const keyButtons = () => collect(tree).filter((node) => typeof node.props?.className === 'string' && node.props.className.startsWith('dec-key'));

const submitted = [];
const ctx = {
  effect: (fn) => fn(),
  sessions: { scope: (id) => (id === 's1' ? { get: () => ({ input: { for: () => ({ actions: { submit: () => submitted.push(id) } }) } }) } : undefined) },
  slots: {
    inject: (name, cb) => cb(),
    register: (definition, Component) => {
      ctx.slots.definition = definition;
      ctx.slots.Component = Component;
      return () => {};
    },
  },
};

/** Load client.js the way the Harness module loader does, and apply it to a stub ctx. */
function boot() {
  let loaded;
  globalThis.window.__ModuleLoader__ = { load: (entry) => { loaded = entry; } };
  new Function(source)();
  const plugin = loaded.factory((id) => {
    assert.equal(id, 'react');
    return React;
  });
  assert.deepEqual(plugin.inject, ['slots', 'sessions']);
  plugin.apply(ctx);
  page = ctx.slots.Component;
  assert.equal(ctx.slots.definition.name, 'settings.section');
  assert.equal(ctx.slots.definition.label(), '发送按键');
  hooks = [];
  draw();
  assert.equal(listeners.keydown.capture, true, 'the listener must win the race against the composer');
}

/** A trusted keydown as the browser delivers it. */
const key = (over) => ({
  isTrusted: true,
  code: 'Enter',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  keyCode: 13,
  target: editor,
  prevented: 0,
  stopped: 0,
  preventDefault() { this.prevented += 1; },
  stopPropagation() { this.stopped += 1; },
  ...over,
});
const keydown = (event) => listeners.keydown.fn(event);

// Unusable storage falls back to the defaults instead of breaking the composer.
store.set(STORE, '{"send":{"code":42},"newline":null}');
boot();
assert.deepEqual(keyButtons().map(label), ['Enter', '⌘Enter']);

// A profile with nothing stored starts on Enter to send, ⌘Enter to break the line.
store.clear();
boot();
assert.deepEqual(keyButtons().map(label), ['Enter', '⌘Enter']);

// Enter sends; ⌘Enter breaks the line instead of sending.
let event = key();
keydown(event);
assert.deepEqual(submitted, ['s1']);
assert.equal(event.prevented, 1, 'the composer must not also see the send chord');
assert.equal(event.stopped, 1);

event = key({ metaKey: true });
keydown(event);
assert.deepEqual(submitted, ['s1'], 'the newline chord must not send');
assert.equal(editor.dispatched.length, 1);
assert.equal(editor.dispatched[0].type, 'keydown');
assert.equal(editor.dispatched[0].shiftKey, true, 'the replayed chord is Shift+Enter');
assert.equal(editor.dispatched[0].isTrusted, false, 'the replay must be recognisable as its own');

// Everything that is not the composer keeps its own Enter.
keydown(key({ target: { closest: () => null } }));
assert.deepEqual(submitted, ['s1']);
// The replayed line break must not loop back through the listener; a composing IME owns Enter.
keydown(key({ isTrusted: false }));
keydown(key({ isComposing: true }));
keydown(key({ keyCode: 229 }));
assert.deepEqual(submitted, ['s1']);
assert.equal(editor.dispatched.length, 1);

// Holding the send key must not queue a burst of sends, but it must stay swallowed.
event = key({ repeat: true });
keydown(event);
assert.deepEqual(submitted, ['s1']);
assert.equal(event.prevented, 1);

// A composer with no session behind it keeps its own Enter instead of going silent.
const detached = { closest: () => null, dispatchEvent: () => true };
event = key({ target: { closest: (selector) => (selector === '[data-composer-input]' ? detached : null) } });
keydown(event);
assert.deepEqual(submitted, ['s1']);
assert.equal(event.prevented, 0, 'an unresolvable session must fall back to the shipped path');

// --- recorder ------------------------------------------------------------------------------------
keyButtons()[0].props.onClick();
draw();
assert.equal(label(keyButtons()[0]), '按下新的按键…', 'the armed button asks for a chord');

// A held modifier never becomes a chord on its own.
event = key({ code: 'MetaLeft', metaKey: true });
keydown(event);
draw();
assert.equal(label(keyButtons()[0]), '按下新的按键…');
assert.equal(JSON.parse(store.get(STORE) ?? 'null'), null, 'nothing stored while only a modifier is held');

// ⌘K becomes the send chord.
event = key({ code: 'KeyK', metaKey: true });
keydown(event);
assert.equal(event.prevented, 1, 'the recording key must not reach the page');
assert.deepEqual(JSON.parse(store.get(STORE)).send, { code: 'KeyK', ctrl: false, meta: true, alt: false, shift: false });
draw();
assert.equal(label(keyButtons()[0]), '⌘K');

// The new chord is what the composer honours now; the old one no longer sends.
keydown(key({ code: 'KeyK', metaKey: true }));
assert.deepEqual(submitted, ['s1', 's1']);
keydown(key());
assert.deepEqual(submitted, ['s1', 's1'], 'the abandoned chord is inert');

// Escape cancels a recording without touching the stored chord.
keyButtons()[1].props.onClick();
draw();
keydown(key({ code: 'Escape', shiftKey: false }));
draw();
assert.equal(label(keyButtons()[1]), '⌘Enter');

// A chord the other slot already owns is refused, and the page says why.
keyButtons()[1].props.onClick();
draw();
keydown(key({ code: 'KeyK', metaKey: true }));
draw();
assert.equal(label(keyButtons()[1]), '⌘Enter');
assert.equal(collect(tree).some((node) => node.props?.className === 'dec-error'), true);
assert.deepEqual(JSON.parse(store.get(STORE)).newline, { code: 'Enter', ctrl: false, meta: true, alt: false, shift: false });

console.log('self-check ok');
