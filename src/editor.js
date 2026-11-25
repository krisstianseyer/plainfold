import { basicSetup } from "codemirror";
import {
  indentWithTab,
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import {
  HighlightStyle,
  StreamLanguage,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { tags } from "@lezer/highlight";

import { linkAt } from "./link-utils.js";

function languageFor(path) {
  const name = (path ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot + 1);
  switch (ext) {
    case "json":
      return json();
    case "xml":
      return xml();
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "bat":
    case "cmd":
      return StreamLanguage.define(shell);
    case "log":
    default:
      return [];
  }
}

/**
 * Light content backgrounds are deliberately monochrome: syntax roles are
 * separated by weight and italics instead of hue, so the editor matches the
 * selected content pane.
 */
const whiteSyntax = HighlightStyle.define([
  { tag: tags.comment, color: "#6a6a6a", fontStyle: "italic" },
  { tag: [tags.keyword, tags.modifier], color: "#111111", fontWeight: "600" },
  {
    tag: [tags.atom, tags.bool, tags.number, tags.null],
    color: "#1f1f1f",
    fontWeight: "600",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape],
    color: "#3a3a3a",
  },
  { tag: [tags.operator, tags.punctuation], color: "#555555" },
  { tag: tags.variableName, color: "#1a1a1a" },
  {
    tag: tags.definition(tags.variableName),
    color: "#000000",
    fontWeight: "600",
  },
  {
    tag: tags.function(tags.variableName),
    color: "#111111",
    fontWeight: "600",
  },
  { tag: [tags.propertyName, tags.attributeName], color: "#2e2e2e" },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "#222222",
    fontWeight: "600",
  },
  { tag: tags.tagName, color: "#111111", fontWeight: "600" },
  { tag: [tags.meta, tags.labelName], color: "#5c5c5c" },
  { tag: tags.heading, color: "#000000", fontWeight: "700" },
  { tag: tags.link, color: "#111111", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.invalid, color: "#8f1d16", textDecoration: "underline" },
]);

const whiteEditorTheme = EditorView.theme(
  {
    "&": {
      color: "var(--content-text)",
      backgroundColor: "var(--content-bg)",
    },
    ".cm-content": {
      caretColor: "var(--editor-accent)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--editor-accent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in srgb, var(--editor-accent) 24%, var(--content-bg))",
    },
    ".cm-gutters": {
      backgroundColor: "var(--content-bg)",
      color: "var(--content-muted)",
      borderRight: "1px solid var(--content-border)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--editor-accent) 5%, var(--content-bg))",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--editor-accent) 5%, var(--content-bg))",
      color: "var(--content-text)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "color-mix(in srgb, var(--editor-accent) 12%, var(--content-bg))",
    },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, var(--editor-accent) 20%, var(--content-bg))",
      outline: "1px solid color-mix(in srgb, var(--editor-accent) 55%, var(--content-bg))",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "color-mix(in srgb, var(--editor-accent) 32%, var(--content-bg))",
    },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "color-mix(in srgb, var(--editor-accent) 18%, var(--content-bg))",
      outline: "1px solid color-mix(in srgb, var(--editor-accent) 55%, var(--content-bg))",
    },
    ".cm-panels": {
      backgroundColor: "var(--content-bg)",
      color: "var(--content-text)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--content-bg)",
      border: "1px solid var(--content-border)",
    },
  },
  { dark: false }
);

/** Themes that do not name their own editor palette use the default light one. */
const EDITOR_THEMES = {
  dark: oneDark,
  nord: oneDark,
  "solarized-dark": oneDark,
  midnight: oneDark,
  forest: oneDark,
  white: [whiteEditorTheme, syntaxHighlighting(whiteSyntax)],
  "content-light": [whiteEditorTheme, syntaxHighlighting(whiteSyntax)],
};

function themeExtension(name) {
  return EDITOR_THEMES[name] ?? [];
}

/**
 * CodeMirror is used only for editing and syntax highlighting. It never
 * renders HTML or executes anything.
 */
export function createEditor({
  parent,
  doc,
  path,
  readOnly = false,
  wrap = false,
  tabWidth = 4,
  theme = "light",
  syntaxHighlighting = true,
  onChange = () => {},
  onSave = () => {},
  onSearch = () => {},
  onFindFiles = () => {},
  onOpenLink = () => {},
  onUndo = () => false,
  onRedo = () => false,
}) {
  const wrapCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const tabCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const syntaxCompartment = new Compartment();

  const shortcuts = Prec.highest(
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSave();
          return true;
        },
      },
      {
        key: "Mod-f",
        preventDefault: true,
        run: () => {
          onSearch();
          return true;
        },
      },
      {
        key: "Mod-Shift-f",
        preventDefault: true,
        run: () => {
          onFindFiles();
          return true;
        },
      },
      {
        // Undo falls through to the rest of the app once the editor's own
        // history runs out, so repository steps can be undone from here too.
        key: "Mod-z",
        preventDefault: true,
        run: (view) => (undo(view) ? true : onUndo() || true),
      },
      {
        key: "Mod-y",
        preventDefault: true,
        run: (view) => (redo(view) ? true : onRedo() || true),
      },
      {
        key: "Mod-Shift-z",
        preventDefault: true,
        run: (view) => (redo(view) ? true : onRedo() || true),
      },
    ])
  );

  const state = EditorState.create({
    doc,
    extensions: [
      basicSetup,
      shortcuts,
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position === null) return false;
          const line = view.state.doc.lineAt(position);
          const link = linkAt(line.text, position - line.from);
          if (!link) return false;
          event.preventDefault();
          onOpenLink(link.path);
          return true;
        },
      }),
      keymap.of([indentWithTab]),
      syntaxCompartment.of(syntaxHighlighting ? languageFor(path) : []),
      tabCompartment.of([
        EditorState.tabSize.of(tabWidth),
        indentUnit.of(" ".repeat(tabWidth)),
      ]),
      wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
      themeCompartment.of(themeExtension(theme)),
      readOnlyCompartment.of([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange();
      }),
    ],
  });

  const view = new EditorView({ state, parent });

  function selectedText() {
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function readClipboard() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }

  function focusSearchField(name) {
    requestAnimationFrame(() => {
      const field = view.dom.querySelector(`.cm-search input[name="${name}"]`);
      field?.focus();
      field?.select?.();
    });
  }

  return {
    view,
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    canUndo: () => undoDepth(view.state) > 0,
    canRedo: () => redoDepth(view.state) > 0,
    undo: () => undo(view),
    redo: () => redo(view),
    find() {
      openSearchPanel(view);
      view.focus();
      focusSearchField("search");
    },
    replace() {
      openSearchPanel(view);
      view.focus();
      focusSearchField("replace");
    },
    async copy() {
      const text = selectedText();
      if (!text) return false;
      return writeClipboard(text);
    },
    async cut() {
      const text = selectedText();
      if (!text) return false;
      if (!(await writeClipboard(text))) return false;
      view.dispatch(view.state.replaceSelection(""));
      return true;
    },
    async paste() {
      const text = await readClipboard();
      if (!text) return false;
      view.dispatch(view.state.replaceSelection(text));
      return true;
    },
    deleteSelection: () => {
      view.dispatch(view.state.replaceSelection(""));
      return true;
    },
    selectAll: () => selectAll(view),
    setWrap(enabled) {
      view.dispatch({
        effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
    },
    setTheme(name) {
      view.dispatch({
        effects: themeCompartment.reconfigure(themeExtension(name)),
      });
    },
    setTabWidth(width) {
      view.dispatch({
        effects: tabCompartment.reconfigure([
          EditorState.tabSize.of(width),
          indentUnit.of(" ".repeat(width)),
        ]),
      });
    },
    setSyntaxHighlighting(enabled) {
      view.dispatch({
        effects: syntaxCompartment.reconfigure(enabled ? languageFor(path) : []),
      });
    },
    setReadOnly(value) {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(value),
          EditorView.editable.of(!value),
        ]),
      });
    },
    replaceDoc(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    },
    selection() {
      const { from, to, head } = view.state.selection.main;
      return { from, to, head };
    },
    hasFocus() {
      return view.hasFocus;
    },
    openAtLine(line) {
      const target = Math.min(Math.max(Number(line) || 1, 1), view.state.doc.lines);
      const info = view.state.doc.line(target);
      view.dispatch({
        selection: { anchor: info.from },
        effects: EditorView.scrollIntoView(info.from, { y: "center" }),
      });
      view.focus();
    },
  };
}
