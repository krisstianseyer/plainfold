import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { StreamLanguage, indentUnit } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";

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
  dark = false,
  onChange = () => {},
  onSave = () => {},
  onSearch = () => {},
}) {
  const wrapCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const tabCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();

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
    ])
  );

  const state = EditorState.create({
    doc,
    extensions: [
      basicSetup,
      shortcuts,
      keymap.of([indentWithTab]),
      languageFor(path),
      tabCompartment.of([
        EditorState.tabSize.of(tabWidth),
        indentUnit.of(" ".repeat(tabWidth)),
      ]),
      wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
      themeCompartment.of(dark ? oneDark : []),
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

  return {
    view,
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    setWrap(enabled) {
      view.dispatch({
        effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
    },
    setTheme(isDark) {
      view.dispatch({
        effects: themeCompartment.reconfigure(isDark ? oneDark : []),
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
    setReadOnly(value) {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(value),
          EditorView.editable.of(!value),
        ]),
      });
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
