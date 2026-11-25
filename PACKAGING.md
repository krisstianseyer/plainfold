# Packaging

Plainfold builds all three required installers from one codebase. Tauri only builds installers for the operating system it runs on, so the release matrix builds each family on its own machine or container.

## Windows 11

Requirements: Node, Rust (MSVC toolchain), WebView2 (included in Windows 11), and the Tauri prerequisites.

```powershell
npm ci
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Results:

- `src-tauri/target/release/plainfold.exe`
- `src-tauri/target/release/bundle/nsis/Plainfold_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Plainfold_<version>_x64_en-US.msi`

`bundle.targets` is `"all"`, so Tauri produces the formats supported on the host. Windows produces NSIS and MSI. Both were install-tested; NSIS remains the default per-user installer for the checklist below.

Install test checklist:

1. Run the NSIS installer as a normal user. The MSI is per-machine and may prompt for elevation.
2. Confirm the installer shows Plainfold and the page-with-cursor icon.
3. Launch from the Start menu. The window title is Plainfold.
4. Confirm the taskbar icon is the page-with-cursor icon.
5. Confirm the Start Menu entry. For MSI, confirm the Desktop shortcut. For NSIS, confirm the finish-page Desktop shortcut option is checked by default.
6. Open a vault, create a file, type text, save with Ctrl+S, close, and reopen. The text is still on disk.
7. Confirm network behavior. With the placeholder update source, launch makes no request. After configuring a real source, the only request is the optional GitHub Releases check; turn off automatic checks in Settings > Updates and confirm a launch makes no request. Confirm no other network activity and no telemetry.

## Windows portable edition

The portable edition is a plain folder containing `Plainfold.exe` and a short README, with no archive or installer. It keeps its state next to the executable:

- Settings, search index, logs, and WebView2 data live in `Plainfold-data/` beside `Plainfold.exe`.
- The folder is assembled fresh and ships no settings, logs, search index, or other user data.
- It uses its own identifier (`com.plainfold.app.portable`), so it can run alongside an installed copy and does not read the installed copy's data.
- Windows 11 includes WebView2; Windows 10 needs the WebView2 Evergreen Runtime.

Build:

```powershell
npm ci
npm run portable
```

Result: `src-tauri/target/release/bundle/portable/Plainfold_<version>_portable_x64/`

The portable build uses a separate Cargo target directory (`src-tauri/target/portable`), so it does not overwrite the installed release binary or the installers.

Portable test checklist:

1. Copy the folder to a writable local folder or USB stick.
2. Launch `Plainfold.exe`. Confirm `Plainfold-data` appears next to it and that no settings from an installed copy appear.
3. Open a vault, create a file, type, save with Ctrl+S, close, and reopen. Confirm the text persists.
4. Confirm `Plainfold-data` holds the settings, search index, logs, and WebView2 data.
5. Delete `Plainfold-data`, relaunch, and confirm the edition starts blank.
6. Move or rename the extracted folder and confirm it still runs with its state beside the exe.

## Debian family (Debian, Ubuntu, Mint, Pop! OS)

System packages (Ubuntu 22.04/24.04 names):

```sh
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Build:

```sh
npm ci
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles deb
```

Result: `src-tauri/target/release/bundle/deb/plainfold_<version>_amd64.deb`

Install test:

```sh
sudo dpkg -i src-tauri/target/release/bundle/deb/plainfold_<version>_amd64.deb
plainfold
```

On first launch, accept the Desktop shortcut prompt and confirm `Plainfold.desktop` appears on the Desktop. Decline on a later clean-profile run and confirm the app does not ask again. Confirm the application-menu entry exists. Then repeat the open/create/edit/save checklist. Remove with `sudo apt remove plainfold`.

## Fedora and Red Hat family (Fedora, RHEL, Rocky, AlmaLinux)

System packages (Fedora names):

```sh
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel gcc gcc-c++ make
```

Build:

```sh
npm ci
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles rpm
```

Result: `src-tauri/target/release/bundle/rpm/plainfold-<version>-1.x86_64.rpm`

Install test:

```sh
sudo dnf install ./src-tauri/target/release/bundle/rpm/plainfold-<version>-1.x86_64.rpm
plainfold
```

On first launch, accept the Desktop shortcut prompt and confirm `Plainfold.desktop` appears on the Desktop. Decline on a later clean-profile run and confirm the app does not ask again. Confirm the application-menu entry exists. Then repeat the checklist. Remove with `sudo dnf remove plainfold`.

## CI

`.github/workflows/build.yml` runs:

- Windows: tests plus NSIS/MSI bundles and the portable folder.
- Ubuntu 22.04: tests plus `.deb`.
- Fedora container: tests, `.rpm` build, and an RPM install check.

Artifacts are uploaded per job. A release is only complete after the Windows, Debian-family, and Fedora-family install tests above have been performed on real machines or VMs.

## Verification performed

The results below cover v1.1.27. The v1.2.0 round builds the front-end bundle and the release binary only, so it produces no installers.

This build was verified as follows:

- Windows: NSIS and MSI install, launch, and uninstall passed. NSIS was rebuilt after the desktop-shortcut change; its finish-page Desktop shortcut option is checked by default.
- Ubuntu 24.04 WSL (Debian family): `npm run tauri build -- --bundles deb` produced the package; `apt` install, `ldd` missing-library check, and removal passed.
- Ubuntu 24.04 WSL: 57 unit tests and 9 integration tests pass, including Linux XDG desktop-shortcut parsing, file creation, drag-move index migration, and GFS revision history. The `.deb`/`.rpm` artifacts need a rebuild and a real desktop-session prompt test.
- `.rpm`: `npm run tauri build -- --bundles rpm` invoked `rpmbuild` from the same source; digest, metadata, dependencies, and file list were inspected. The Fedora CI job installs the RPM; launching it on a Fedora desktop remains a VM step.

- Windows 1.6.2 portable: folder assembled from a fresh staging directory with the detailed README; the copy launched and created `Plainfold-data` (WebView2 data plus logs) beside the exe, while the installed copy's `%APPDATA%` and `%LOCALAPPDATA%` folders were untouched.

## Icons

The master icon is `assets/icon-master.png`. Regenerate all platform icons with:

```sh
npm run icon
```

`tauri icon` writes Windows, Linux, macOS, iOS, and Android sizes. Only Windows and Linux are shipped in v1.

## Bundle identifier and publisher

`src-tauri/tauri.conf.json` currently uses the placeholder `com.plainfold.app` and publisher `Plainfold`. Replace both with the owner's reverse-DNS identifier and legal publisher name before a public release. Changing the identifier later changes app data and config folders.
