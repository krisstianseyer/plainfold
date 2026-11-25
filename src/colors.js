/**
 * Colored icons and labels.
 *
 * A small, self-contained layer that maps repository entries (by extension,
 * folder, or exact path), plus the sidebar section headers, to an icon color
 * and an optional label color. Colors are stored as hex strings in settings so
 * they persist through settings.json.
 */

export const COLOR_PALETTE = [
  { name: "Red", value: "#e5484d" },
  { name: "Orange", value: "#f76b15" },
  { name: "Amber", value: "#f2a93b" },
  { name: "Lime", value: "#8fbf3f" },
  { name: "Green", value: "#30a46c" },
  { name: "Teal", value: "#12a594" },
  { name: "Cyan", value: "#12a0c4" },
  { name: "Blue", value: "#3e63dd" },
  { name: "Indigo", value: "#6e56cf" },
  { name: "Violet", value: "#8e4ec6" },
  { name: "Pink", value: "#d6409f" },
  { name: "Slate", value: "#6b7280" },
];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RULE_KINDS = new Set(["extension", "folder", "other", "section", "repository"]);
const SECTION_TARGETS = new Set(["files", "pinned", "recent", "repositories"]);
const MAX_RULES = 200;
const MAX_OVERRIDES = 500;

export const SECTION_LABELS = [
  { target: "files", label: "Files" },
  { target: "pinned", label: "Pinned" },
  { target: "recent", label: "Recent" },
  { target: "repositories", label: "Repositories" },
];

const config = {
  getSettings: () => ({}),
  getRepositories: () => [],
  commit: () => {},
  onChange: () => {},
  onStatus: () => {},
  basename: (path) => String(path).split(/[\\/]/).pop() ?? "",
};

export function configureColors(next) {
  Object.assign(config, next);
}

/* ------------------------------------------------------------------ */
/* Values and persistence                                              */
/* ------------------------------------------------------------------ */

export function normalizeColor(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return HEX_COLOR.test(text) ? text : null;
}

export function extensionOf(path) {
  const name = config.basename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase() || null;
}

function safeRelativePath(path) {
  const text = typeof path === "string" ? path.trim() : "";
  if (!text || text.length > 1024) return null;
  if (text.startsWith("/") || text.startsWith("\\") || /^[a-z]:/i.test(text)) {
    return null;
  }
  if (text.split(/[\\/]+/).some((segment) => segment === "..")) return null;
  return text;
}

function normalizePair(pair) {
  if (!pair || typeof pair !== "object") return { icon: null, label: null };
  return {
    icon: normalizeColor(pair.icon),
    label: normalizeColor(pair.label),
  };
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const kind = String(rule.kind ?? "").trim().toLowerCase();
  if (!RULE_KINDS.has(kind)) return null;
  let target = String(rule.target ?? "").trim().toLowerCase();
  if (kind === "extension") {
    target = target.replace(/^\.+/, "");
    if (!target || target.length > 24) return null;
  } else if (kind === "section") {
    if (!SECTION_TARGETS.has(target)) return null;
  } else if (kind === "repository") {
    target = String(rule.target ?? "").trim();
    if (!target || target.length > 1024) return null;
  } else {
    target = "";
  }
  const pair = normalizePair(rule);
  if (!pair.icon && !pair.label) return null;
  return { kind, target, icon: pair.icon, label: pair.label };
}

/** Coerce whatever came off disk into the shape the UI expects. */
export function normalizeColorSettings(values = {}) {
  const rules = [];
  const seen = new Set();
  for (const candidate of Array.isArray(values.colorRules) ? values.colorRules : []) {
    const rule = normalizeRule(candidate);
    if (!rule) continue;
    const key = `${rule.kind}\u0000${rule.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
    if (rules.length >= MAX_RULES) break;
  }
  const overrides = {};
  const source =
    values.colorOverrides && typeof values.colorOverrides === "object"
      ? values.colorOverrides
      : {};
  for (const [rawPath, rawPair] of Object.entries(source)) {
    if (Object.keys(overrides).length >= MAX_OVERRIDES) break;
    const path = safeRelativePath(rawPath);
    if (!path) continue;
    const pair = normalizePair(rawPair);
    if (!pair.icon && !pair.label) continue;
    overrides[path] = pair;
  }
  return {
    colorIcons: values.colorIcons !== false,
    colorRules: rules,
    colorOverrides: overrides,
  };
}

export const DEFAULT_COLOR_SETTINGS = Object.freeze({
  colorIcons: true,
  colorRules: [],
  colorOverrides: {},
});

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

function findRule(settings, kind, target) {
  const rules = settings.colorRules ?? [];
  for (const rule of rules) {
    if (rule.kind === kind && rule.target === (target ?? "")) return rule;
  }
  return null;
}

function pairOf(rule) {
  return rule ? { icon: rule.icon ?? null, label: rule.label ?? null } : { icon: null, label: null };
}

export function resolvePathColors(settings, path, isDir) {
  if (!settings?.colorIcons) return { icon: null, label: null };
  const override = settings.colorOverrides?.[path];
  let base = { icon: null, label: null };
  if (isDir) {
    base = pairOf(findRule(settings, "folder", ""));
  } else {
    const extRule = findRule(settings, "extension", extensionOf(path));
    base = extRule ? pairOf(extRule) : pairOf(findRule(settings, "other", ""));
  }
  return {
    icon: override?.icon ?? base.icon,
    label: override?.label ?? base.label,
  };
}

export function resolveSectionColors(settings, target) {
  if (!settings?.colorIcons) return { icon: null, label: null };
  return pairOf(findRule(settings, "section", target));
}

export function resolveRepositoryColors(settings, path) {
  if (!settings?.colorIcons) return { icon: null, label: null };
  return pairOf(findRule(settings, "repository", path));
}

/** Color a saved-repository row. Repositories have no glyph, so the name shows it. */
export function decorateRepository(button, name, path) {
  const colors = resolveRepositoryColors(config.getSettings(), path);
  paintLabel(name, colors.label ?? colors.icon);
}

/* ------------------------------------------------------------------ */
/* Painting                                                            */
/* ------------------------------------------------------------------ */

export function paintGlyph(element, color) {
  if (!element) return;
  if (color) element.style.setProperty("--pf-icon-color", color);
  else element.style.removeProperty("--pf-icon-color");
}

export function paintLabel(element, color) {
  if (!element) return;
  if (color) element.style.color = color;
  else element.style.removeProperty("color");
}

/** Tree rows: color the glyph and the name independently. */
export function decorateTreeEntry(glyph, name, path, isDir) {
  const colors = resolvePathColors(config.getSettings(), path, isDir);
  paintGlyph(glyph, colors.icon);
  paintLabel(name, colors.label);
  return colors;
}

/** Rows without their own glyph (short lists, search hits). */
export function decorateLabel(element, path, isDir = false) {
  const colors = resolvePathColors(config.getSettings(), path, isDir);
  paintLabel(element, colors.label ?? colors.icon);
  return colors;
}

/** Color a section header's glyph and label. */
export function paintSection(svg, label, target) {
  const colors = resolveSectionColors(config.getSettings(), target);
  if (svg) {
    if (colors.icon) svg.style.color = colors.icon;
    else svg.style.removeProperty("color");
  }
  paintLabel(label, colors.label ?? colors.icon);
}

/** Apply section colors to every header in the shell. */
export function applySectionColors(root = document) {
  const groups = [
    { target: "files", selectors: ['#repository-label', '.sidebar-nav-item[data-home-filter="all"]'] },
    { target: "pinned", selectors: ['#pinned-title', '.sidebar-nav-item[data-home-filter="pinned"]'] },
    { target: "recent", selectors: ['#recent-title', '.sidebar-nav-item[data-home-filter="recent"]'] },
    { target: "repositories", selectors: ["#repositories-section .side-title"] },
  ];
  for (const group of groups) {
    for (const selector of group.selectors) {
      const element = root.querySelector(selector);
      if (!element) continue;
      const svg = element.querySelector("svg");
      const label = svg ? element.querySelector("span") : element;
      paintSection(svg, label, group.target);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rule editing                                                        */
/* ------------------------------------------------------------------ */

function settingsObject() {
  const settings = config.getSettings();
  if (!Array.isArray(settings.colorRules)) settings.colorRules = [];
  if (!settings.colorOverrides || typeof settings.colorOverrides !== "object") {
    settings.colorOverrides = {};
  }
  return settings;
}

export function upsertRule(kind, target, channel, color) {
  const settings = settingsObject();
  const normalized = normalizeColor(color);
  const key = kind === "extension" ? target.toLowerCase().replace(/^\.+/, "") : target;
  let rule = settings.colorRules.find(
    (item) => item.kind === kind && item.target === (key ?? "")
  );
  if (!rule) {
    if (!normalized) return;
    rule = { kind, target: key ?? "", icon: null, label: null };
    settings.colorRules.push(rule);
  }
  rule[channel] = normalized;
  pruneRules(settings);
  commitColors();
}

export function removeRule(kind, target) {
  const settings = settingsObject();
  settings.colorRules = settings.colorRules.filter(
    (item) => !(item.kind === kind && item.target === (target ?? ""))
  );
  commitColors();
}

export function setOverride(path, channel, color) {
  const settings = settingsObject();
  const normalized = normalizeColor(color);
  const current = settings.colorOverrides[path] ?? { icon: null, label: null };
  const next = { ...current, [channel]: normalized };
  if (!next.icon && !next.label) delete settings.colorOverrides[path];
  else settings.colorOverrides[path] = next;
  commitColors();
}

export function clearOverride(path) {
  const settings = settingsObject();
  delete settings.colorOverrides[path];
  commitColors();
}

export function colorTargetForPath(path, isDir) {
  if (isDir) return { kind: "folder", target: "" };
  const ext = extensionOf(path);
  if (ext) return { kind: "extension", target: ext };
  return { kind: "other", target: "" };
}

function pruneRules(settings) {
  settings.colorRules = settings.colorRules.filter(
    (rule) => rule.icon || rule.label
  );
}

function commitColors() {
  config.commit();
  config.onChange();
}

/* ------------------------------------------------------------------ */
/* Color picker popover                                                */
/* ------------------------------------------------------------------ */

let openPopover = null;

/** Popovers live on body; keep their clicks away from the app's global menus. */
function keepClicksInside(element) {
  for (const type of ["mousedown", "click", "contextmenu"]) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }
}

function closePopover() {
  if (!openPopover) return;
  const { element, cleanup } = openPopover;
  cleanup();
  element.remove();
  openPopover = null;
}

function positionPopover(element, anchor) {
  const rect = anchor.getBoundingClientRect();
  element.style.visibility = "hidden";
  // A modal <dialog> paints in the top layer, so a body-level popover would sit
  // behind it. Host the popover in the dialog that owns the anchor when there is one.
  const host = anchor.closest?.("dialog") ?? document.body;
  host.append(element);
  let bounds = element.getBoundingClientRect();
  const maxHeight = window.innerHeight - 16;
  if (bounds.height > maxHeight) {
    element.style.maxHeight = `${maxHeight}px`;
    element.style.overflowY = "auto";
    bounds = element.getBoundingClientRect();
  }
  let left = rect.right + 6;
  if (left + bounds.width > window.innerWidth - 8) {
    left = Math.max(8, rect.left - bounds.width - 6);
  }
  let top = rect.top;
  if (top + bounds.height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - bounds.height - 8);
  }
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.visibility = "";
}

/**
 * Shared swatch + hex picker. Returns the created element.
 * options: { title, value, allowClear, allowMatch, onPick(color|null) }
 */
export function openColorPicker(anchor, options) {
  closePopover();
  const { title = "Color", value = null, allowClear = true, allowMatch = false } =
    options;
  const element = document.createElement("div");
  element.className = "color-popover";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", title);
  keepClicksInside(element);

  const heading = document.createElement("p");
  heading.className = "color-popover-title";
  heading.textContent = title;

  const grid = document.createElement("div");
  grid.className = "color-swatch-grid";
  for (const swatch of COLOR_PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-swatch";
    button.style.setProperty("--swatch", swatch.value);
    button.title = swatch.name;
    button.setAttribute("aria-label", swatch.name);
    if (value && normalizeColor(value) === swatch.value) {
      button.classList.add("is-active");
    }
    button.addEventListener("click", () => {
      options.onPick(swatch.value);
      closePopover();
    });
    grid.append(button);
  }

  const hexRow = document.createElement("div");
  hexRow.className = "color-hex-row";
  const hexLabel = document.createElement("label");
  hexLabel.className = "color-hex-label";
  hexLabel.textContent = "Hex";
  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "color-hex";
  hexInput.placeholder = "#3e63dd";
  hexInput.value = normalizeColor(value) ?? "";
  hexInput.spellcheck = false;
  hexInput.autocomplete = "off";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "button small";
  apply.textContent = "Apply";
  const submitHex = () => {
    const normalized = normalizeColor(hexInput.value);
    if (!normalized) {
      hexInput.classList.add("is-invalid");
      return;
    }
    options.onPick(normalized);
    closePopover();
  };
  apply.addEventListener("click", submitHex);
  hexInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitHex();
  });
  hexLabel.append(hexInput);
  hexRow.append(hexLabel, apply);

  element.append(heading, grid, hexRow);

  if (allowMatch && options.matchValue) {
    const match = document.createElement("button");
    match.type = "button";
    match.className = "color-popover-action";
    match.textContent = "Match icon color";
    match.addEventListener("click", () => {
      options.onPick(options.matchValue);
      closePopover();
    });
    element.append(match);
  }
  if (allowClear) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "color-popover-action";
    clear.textContent = "No color";
    clear.addEventListener("click", () => {
      options.onPick(null);
      closePopover();
    });
    element.append(clear);
  }

  positionPopover(element, anchor);
  openPopover = {
    element,
    cleanup() {
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", closePopover, true);
      window.removeEventListener("resize", closePopover);
    },
  };
  const onOutside = (event) => {
    if (!element.contains(event.target)) closePopover();
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePopover();
    }
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", closePopover, true);
    window.addEventListener("resize", closePopover);
  }, 0);
  return element;
}

/* ------------------------------------------------------------------ */
/* Context menu                                                        */
/* ------------------------------------------------------------------ */

function menuButton(label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.textContent = label;
  if (className) button.className = className;
  return button;
}

function svgSwatchGrid(onPick, activeValue) {
  const grid = document.createElement("div");
  grid.className = "color-swatch-grid";
  for (const swatch of COLOR_PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-swatch";
    button.style.setProperty("--swatch", swatch.value);
    button.title = swatch.name;
    button.setAttribute("aria-label", swatch.name);
    if (normalizeColor(activeValue) === swatch.value) {
      button.classList.add("is-active");
    }
    button.addEventListener("click", () => onPick(swatch.value));
    grid.append(button);
  }
  return grid;
}

/**
 * Append a "Color" submenu to the existing context menu.
 * context: { path, isDir, section } where section is "files"|"pinned"|"recent".
 */
let menuCleanup = null;

/** Close any color panel opened from the context menu. */
export function closeColorMenu() {
  menuCleanup?.();
  menuCleanup = null;
  closePopover();
}

export function appendColorMenu(menu, context, { setStatus } = config) {
  closeColorMenu();
  const settings = config.getSettings();
  if (!settings.colorIcons || !context) return;

  const repositoryPath = context.repositoryPath ?? null;
  const isSection = Boolean(context.section);
  const isRepository = Boolean(repositoryPath);
  const target = isRepository
    ? { kind: "repository", target: repositoryPath }
    : isSection
      ? { kind: "section", target: context.section }
      : colorTargetForPath(context.path, context.isDir);
  // Only files and folders get a "this one only" scope.
  const scoped = !isSection && !isRepository;
  let onlyThis = false;

  const item = menuButton("Color", "menu-item-submenu");
  item.setAttribute("aria-haspopup", "true");
  const arrow = document.createElement("span");
  arrow.className = "menu-submenu-arrow";
  arrow.textContent = "›";
  item.append(arrow);

  const subject = isSection
    ? `${SECTION_LABELS.find((entry) => entry.target === context.section)?.label ?? "Section"} header`
    : isRepository
      ? context.repositoryName || config.basename(repositoryPath)
      : target.kind === "extension"
        ? `.${target.target} files`
        : target.kind === "folder"
          ? "All folders"
          : "Other files";

  let panel = null;
  let lastPick = null;

  const closePanel = () => {
    if (!panel) return;
    panel.remove();
    panel = null;
    item.classList.remove("is-open");
  };

  function currentColors() {
    const active = config.getSettings();
    if (isSection) return resolveSectionColors(active, context.section);
    if (isRepository) return resolveRepositoryColors(active, repositoryPath);
    if (onlyThis) {
      const override = active.colorOverrides?.[context.path];
      return {
        icon: override?.icon ?? null,
        label: override?.label ?? null,
      };
    }
    return resolvePathColors(active, context.path, context.isDir);
  }

  function applyColor(channel, color) {
    if (isSection) {
      upsertRule("section", context.section, channel, color);
    } else if (isRepository) {
      upsertRule("repository", repositoryPath, channel, color);
    } else if (onlyThis) {
      setOverride(context.path, channel, color);
    } else {
      upsertRule(target.kind, target.target, channel, color);
      setOverride(context.path, channel, null);
    }
    lastPick = { channel, color };
    setStatus(color ? "Color updated." : "Color cleared.");
  }

  /** Move the last pick between "all files" and "this one only". */
  function movePick() {
    if (!lastPick || !scoped) return;
    const { channel, color } = lastPick;
    if (onlyThis) {
      setOverride(context.path, channel, color);
      upsertRule(target.kind, target.target, channel, null);
    } else {
      upsertRule(target.kind, target.target, channel, color);
      setOverride(context.path, channel, null);
    }
  }

  function renderBody() {
    panel.textContent = "";
    const colors = currentColors();

    const heading = document.createElement("p");
    heading.className = "color-popover-title";
    heading.textContent = scoped && onlyThis
      ? `${config.basename(context.path)} only`
      : subject;
    panel.append(heading);

    const iconLabel = document.createElement("p");
    iconLabel.className = "color-submenu-label";
    iconLabel.textContent = "Icon";
    panel.append(iconLabel);
    panel.append(
      svgSwatchGrid((color) => {
        applyColor("icon", color);
        renderBody();
      }, colors.icon)
    );

    const labelLabel = document.createElement("p");
    labelLabel.className = "color-submenu-label";
    labelLabel.textContent = "Label";
    panel.append(labelLabel);
    panel.append(
      svgSwatchGrid((color) => {
        applyColor("label", color);
        renderBody();
      }, colors.label)
    );

    const footer = document.createElement("div");
    footer.className = "color-submenu-footer";

    if (scoped) {
      const scope = document.createElement("label");
      scope.className = "color-scope-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = onlyThis;
      checkbox.addEventListener("change", () => {
        onlyThis = checkbox.checked;
        movePick();
        renderBody();
      });
      const text = document.createElement("span");
      text.textContent = context.isDir ? "This folder only" : "This file only";
      scope.append(checkbox, text);
      footer.append(scope);
    }

    const custom = menuButton("Custom color…");
    custom.className = "color-submenu-reset";
    custom.addEventListener("click", () => {
      openColorPicker(item, {
        title: `${subject} icon`,
        value: colors.icon,
        onPick: (color) => {
          applyColor("icon", color);
          renderBody();
        },
      });
    });
    footer.append(custom);

    const reset = menuButton("Reset color");
    reset.className = "color-submenu-reset";
    reset.addEventListener("click", () => {
      if (isSection) {
        removeRule("section", context.section);
      } else if (isRepository) {
        removeRule("repository", repositoryPath);
      } else if (onlyThis) {
        clearOverride(context.path);
      } else {
        removeRule(target.kind, target.target);
        clearOverride(context.path);
      }
      setStatus("Color reset.");
      closePanel();
      menu.hidden = true;
    });
    footer.append(reset);

    const done = menuButton("Done");
    done.className = "color-submenu-reset color-submenu-done";
    done.addEventListener("click", () => {
      closePanel();
      menu.hidden = true;
    });
    footer.append(done);
    panel.append(footer);
    positionPopover(panel, item);
  }

  const openPanel = () => {
    closePanel();
    onlyThis = scoped ? Boolean(settings.colorOverrides?.[context.path]) : false;
    panel = document.createElement("div");
    panel.className = "context-submenu color-submenu";
    panel.setAttribute("role", "menu");
    keepClicksInside(panel);
    document.body.append(panel);
    renderBody();
    item.classList.add("is-open");
  };

  item.addEventListener("click", (event) => {
    event.stopPropagation();
    openPanel();
  });
  menu.append(item);

  const onOutside = (event) => {
    if (!panel) return;
    if (panel.contains(event.target) || item.contains(event.target)) return;
    closePanel();
  };
  document.addEventListener("mousedown", onOutside, true);
  menuCleanup = () => {
    document.removeEventListener("mousedown", onOutside, true);
    closePanel();
  };
}

/* ------------------------------------------------------------------ */
/* Settings page                                                       */
/* ------------------------------------------------------------------ */

function swatchButton({ value, label, onPick, className = "color-swatch" }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  if (value) {
    button.style.setProperty("--swatch", value);
    button.classList.add("is-set");
  } else {
    button.classList.add("is-empty");
  }
  button.title = value ? `${label}: ${value}` : `${label}: no color`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => onPick(button));
  return button;
}

function ruleRow({ title, subtitle, colors, onIcon, onLabel, onRemove, onReset }) {
  const row = document.createElement("div");
  row.className = "color-rule";
  const text = document.createElement("div");
  text.className = "color-rule-text";
  if (title) {
    const strong = document.createElement("span");
    strong.className = "color-rule-title";
    strong.textContent = title;
    text.append(strong);
  }
  if (subtitle) {
    const small = document.createElement("span");
    small.className = "color-rule-subtitle";
    small.textContent = subtitle;
    text.append(small);
  }
  const swatches = document.createElement("div");
  swatches.className = "color-rule-swatches";
  const iconRow = document.createElement("span");
  iconRow.className = "color-rule-channel";
  const iconCaption = document.createElement("span");
  iconCaption.textContent = "Icon";
  iconRow.append(iconCaption, swatchButton({ value: colors.icon, label: "Icon", onPick: onIcon }));
  const labelRow = document.createElement("span");
  labelRow.className = "color-rule-channel";
  const labelCaption = document.createElement("span");
  labelCaption.textContent = "Label";
  labelRow.append(labelCaption, swatchButton({ value: colors.label, label: "Label", onPick: onLabel }));
  swatches.append(iconRow, labelRow);
  row.append(text, swatches);
  if (onRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "color-rule-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", onRemove);
    row.append(remove);
  } else if (onReset) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "color-rule-remove";
    reset.textContent = "Clear";
    reset.addEventListener("click", onReset);
    row.append(reset);
  }
  return row;
}

function field(label, help, content) {
  const wrapper = document.createElement("div");
  wrapper.className = "settings-field";
  wrapper.dataset.settingsLabel = label;
  if (help) wrapper.dataset.settingsHelp = help;
  content(wrapper);
  return wrapper;
}

export function renderColorSettings(container, { refresh } = {}) {
  if (!container) return;
  const settings = settingsObject();
  const rerender = () => {
    renderColorSettings(container, { refresh });
    config.onChange();
  };
  container.textContent = "";
  const head = document.createElement("div");
  head.className = "settings-panel-head";
  const title = document.createElement("h3");
  title.textContent = "Icon colors";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "button small settings-reset";
  reset.textContent = "Reset";
  reset.addEventListener("click", () => {
    const next = normalizeColorSettings(DEFAULT_COLOR_SETTINGS);
    settings.colorIcons = next.colorIcons;
    settings.colorRules = [];
    settings.colorOverrides = {};
    commitColors();
    rerender();
  });
  head.append(title, reset);
  container.append(head);

  const intro = document.createElement("p");
  intro.className = "settings-help color-intro";
  intro.textContent =
    "Give folders, file types, and sidebar sections their own color. Labels stay neutral until you color them.";
  container.append(intro);

  container.append(
    field(
      "Colored icons",
      "Turn the whole feature on or off. Colors apply to the sidebar, file header, and search results.",
      (wrapper) => {
        const label = document.createElement("label");
        label.className = "accent-area";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = "setting-color-icons";
        checkbox.checked = settings.colorIcons !== false;
        checkbox.addEventListener("change", () => {
          settings.colorIcons = checkbox.checked;
          commitColors();
          rerender();
        });
        label.append(checkbox, document.createTextNode(" Color icons and labels"));
        wrapper.append(label);
      }
    )
  );

  const sections = document.createElement("fieldset");
  sections.className = "settings-group color-group";
  const legend = document.createElement("legend");
  legend.textContent = "Sidebar headers";
  sections.append(legend);
  for (const entry of SECTION_LABELS) {
    const rule = findRule(settings, "section", entry.target);
    sections.append(
      ruleRow({
        title: entry.label,
        colors: pairOf(rule),
        onIcon: (button) =>
          openColorPicker(button, {
            title: `${entry.label} icon`,
            value: rule?.icon,
            onPick: (color) => {
              upsertRule("section", entry.target, "icon", color);
              rerender();
            },
          }),
        onLabel: (button) =>
          openColorPicker(button, {
            title: `${entry.label} label`,
            value: rule?.label,
            allowMatch: true,
            matchValue: rule?.icon,
            onPick: (color) => {
              upsertRule("section", entry.target, "label", color);
              rerender();
            },
          }),
        onReset: rule
          ? () => {
              removeRule("section", entry.target);
              rerender();
            }
          : null,
      })
    );
  }
  container.append(sections);

  const repositories = (config.getRepositories() ?? []).filter(
    (entry) => entry && entry.path
  );
  if (repositories.length) {
    const repoGroup = document.createElement("fieldset");
    repoGroup.className = "settings-group color-group";
    const repoLegend = document.createElement("legend");
    repoLegend.textContent = "Saved repositories";
    repoGroup.append(repoLegend);
    for (const entry of repositories) {
      const rule = findRule(settings, "repository", entry.path);
      repoGroup.append(
        ruleRow({
          title: entry.name || config.basename(entry.path),
          subtitle: entry.path,
          colors: pairOf(rule),
          onIcon: (button) =>
            openColorPicker(button, {
              title: `${entry.name || config.basename(entry.path)} icon`,
              value: rule?.icon,
              onPick: (color) => {
                upsertRule("repository", entry.path, "icon", color);
                rerender();
              },
            }),
          onLabel: (button) =>
            openColorPicker(button, {
              title: `${entry.name || config.basename(entry.path)} label`,
              value: rule?.label,
              allowMatch: true,
              matchValue: rule?.icon,
              onPick: (color) => {
                upsertRule("repository", entry.path, "label", color);
                rerender();
              },
            }),
          onReset: rule
            ? () => {
                removeRule("repository", entry.path);
                rerender();
              }
            : null,
        })
      );
    }
    container.append(repoGroup);
  }
  const kinds = document.createElement("fieldset");
  kinds.className = "settings-group color-group";
  const kindsLegend = document.createElement("legend");
  kindsLegend.textContent = "Folders and unmatched files";
  kinds.append(kindsLegend);
  for (const entry of [
    { kind: "folder", target: "", title: "Folders", subtitle: "Every folder, unless a folder override applies." },
    { kind: "other", target: "", title: "Other files", subtitle: "Files with no extension rule and no extension." },
  ]) {
    const rule = findRule(settings, entry.kind, entry.target);
    kinds.append(
      ruleRow({
        title: entry.title,
        subtitle: entry.subtitle,
        colors: pairOf(rule),
        onIcon: (button) =>
          openColorPicker(button, {
            title: `${entry.title} icon`,
            value: rule?.icon,
            onPick: (color) => {
              upsertRule(entry.kind, entry.target, "icon", color);
              rerender();
            },
          }),
        onLabel: (button) =>
          openColorPicker(button, {
            title: `${entry.title} label`,
            value: rule?.label,
            allowMatch: true,
            matchValue: rule?.icon,
            onPick: (color) => {
              upsertRule(entry.kind, entry.target, "label", color);
              rerender();
            },
          }),
        onReset: rule
          ? () => {
              removeRule(entry.kind, entry.target);
              rerender();
            }
          : null,
      })
    );
  }
  container.append(kinds);

  const extensions = document.createElement("fieldset");
  extensions.className = "settings-group color-group";
  const extLegend = document.createElement("legend");
  extLegend.textContent = "File types";
  extensions.append(extLegend);
  const extRules = settings.colorRules.filter((rule) => rule.kind === "extension");
  if (!extRules.length) {
    const empty = document.createElement("p");
    empty.className = "settings-help";
    empty.textContent = "No file types yet. Add one, or right-click a file in the sidebar.";
    extensions.append(empty);
  }
  for (const rule of extRules) {
    const row = ruleRow({
      title: rule.target ? `.${rule.target}` : "",
      colors: pairOf(rule),
      onIcon: (button) =>
        openColorPicker(button, {
          title: `.${rule.target} icon`,
          value: rule.icon,
          onPick: (color) => {
            upsertRule("extension", rule.target, "icon", color);
            rerender();
          },
        }),
      onLabel: (button) =>
        openColorPicker(button, {
          title: `.${rule.target} label`,
          value: rule.label,
          allowMatch: true,
          matchValue: rule.icon,
          onPick: (color) => {
            upsertRule("extension", rule.target, "label", color);
            rerender();
          },
        }),
      onRemove: () => {
        removeRule("extension", rule.target);
        rerender();
      },
    });
    const extInput = document.createElement("input");
    extInput.type = "text";
    extInput.className = "color-rule-ext";
    extInput.value = rule.target;
    extInput.spellcheck = false;
    extInput.placeholder = "ext";
    extInput.setAttribute("aria-label", `Extension for ${rule.target || "new file type"}`);
    extInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        extInput.blur();
      }
    });
    extInput.addEventListener("change", () => {
      const next = extInput.value.trim().toLowerCase().replace(/^\.+/, "");
      if (!next) {
        settings.colorRules = settings.colorRules.filter((item) => item !== rule);
        renderColorSettings(container, { refresh });
        return;
      }
      if (next === rule.target) return;
      settings.colorRules = settings.colorRules.filter(
        (item) =>
          item === rule ||
          !(item.kind === "extension" && item.target === next)
      );
      rule.target = next;
      pruneRules(settings);
      commitColors();
      rerender();
    });
    row.querySelector(".color-rule-text").prepend(extInput);
    extensions.append(row);
  }
  const addRow = document.createElement("div");
  addRow.className = "inline-field color-add-row";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "button small";
  addButton.textContent = "Add file type";
  addLabel(addButton);
  extensions.append(addRow);
  addRow.append(addButton);
  container.append(extensions);

  function addLabel(button) {
    button.addEventListener("click", () => {
      settings.colorRules.push({ kind: "extension", target: "", icon: null, label: null });
      renderColorSettings(container, { refresh });
      const inputs = container.querySelectorAll(".color-rule-ext");
      inputs[inputs.length - 1]?.focus();
    });
  }

  const overrides = Object.entries(settings.colorOverrides ?? {});
  if (overrides.length) {
    const list = document.createElement("fieldset");
    list.className = "settings-group color-group";
    const overridesLegend = document.createElement("legend");
    overridesLegend.textContent = "Single-file overrides";
    list.append(overridesLegend);
    for (const [path, pair] of overrides) {
      list.append(
        ruleRow({
          title: config.basename(path),
          subtitle: path,
          colors: pair,
          onIcon: (button) =>
            openColorPicker(button, {
              title: `${config.basename(path)} icon`,
              value: pair.icon,
              onPick: (color) => {
                setOverride(path, "icon", color);
                rerender();
              },
            }),
          onLabel: (button) =>
            openColorPicker(button, {
              title: `${config.basename(path)} label`,
              value: pair.label,
              allowMatch: true,
              matchValue: pair.icon,
              onPick: (color) => {
                setOverride(path, "label", color);
                rerender();
              },
            }),
          onRemove: () => {
            clearOverride(path);
            rerender();
          },
        })
      );
    }
    container.append(list);
  }

  if (settings.colorRules.length || overrides.length) {
    const clearAll = document.createElement("div");
    clearAll.className = "inline-field color-add-row";
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "button small";
    clearButton.textContent = "Remove all colors";
    clearButton.addEventListener("click", () => {
      settings.colorRules = [];
      settings.colorOverrides = {};
      commitColors();
      rerender();
    });
    clearAll.append(clearButton);
    container.append(clearAll);
  }
}
