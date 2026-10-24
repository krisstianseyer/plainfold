import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const request = process.argv[2] ?? "patch";
const explicit = /^\d+\.\d+\.\d+$/.test(request);
if (!explicit && !["patch", "minor", "major"].includes(request)) {
  throw new Error("Use patch, minor, major, or an explicit x.y.z version.");
}

const packagePath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const cargoLockPath = resolve(root, "src-tauri/Cargo.lock");
const tauriPath = resolve(root, "src-tauri/tauri.conf.json");

const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const current = pkg.version;
const [major, minor, patch] = current.split(".").map(Number);
if (![major, minor, patch].every(Number.isInteger)) {
  throw new Error(`Unsupported version: ${current}`);
}
const next = explicit
  ? request
  : request === "major"
    ? `${major + 1}.0.0`
    : request === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

function replaceOnce(text, needle, replacement) {
  if (!text.includes(needle)) throw new Error(`Missing version marker: ${needle}`);
  return text.replace(needle, replacement);
}

function replaceFirst(text, pattern, replacement) {
  let replaced = false;
  return text.replace(pattern, (match) => {
    if (replaced) return match;
    replaced = true;
    return replacement(match);
  });
}

const packageText = replaceFirst(
  readFileSync(packagePath, "utf8"),
  /"version": "[^"]+"/,
  () => `"version": "${next}"`
);
writeFileSync(packagePath, packageText);

let lockVersions = 0;
const lockText = readFileSync(lockPath, "utf8").replace(
  /"version": "[^"]+"/g,
  (match) => {
    lockVersions += 1;
    return lockVersions <= 2 ? `"version": "${next}"` : match;
  }
);
if (lockVersions < 2) throw new Error("package-lock.json version fields missing.");
writeFileSync(lockPath, lockText);

const cargoText = replaceOnce(
  readFileSync(cargoPath, "utf8"),
  `version = "${current}"`,
  `version = "${next}"`
);
writeFileSync(cargoPath, cargoText);

const cargoLockText = replaceOnce(
  readFileSync(cargoLockPath, "utf8"),
  `name = "plainfold"\nversion = "${current}"`,
  `name = "plainfold"\nversion = "${next}"`
);
writeFileSync(cargoLockPath, cargoLockText);

const tauriText = replaceFirst(
  readFileSync(tauriPath, "utf8"),
  /"version": "[^"]+"/,
  () => `"version": "${next}"`
);
writeFileSync(tauriPath, tauriText);

console.log(`Plainfold ${current} -> ${next}`);
