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
- `src-tauri/target/release/bundle/nsis/Plainfold_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Plainfold_0.1.0_x64_en-US.msi`

`bundle.targets` is `"all"`, so Tauri produces the formats supported on the host. Windows produces NSIS and MSI. Either satisfies the v1 requirement; use the NSIS installer for the install test.

Verification performed for this build: the NSIS installer completed silently, the installed app launched with the Plainfold window title, and the uninstaller removed the install directory.

Install test checklist:

1. Run the installer as a normal user.
2. Confirm the installer shows Plainfold and the page-with-cursor icon.
3. Launch from the Start menu. The window title is Plainfold.
4. Confirm the taskbar icon is the page-with-cursor icon.
5. Open a vault, create a file, type text, save with Ctrl+S, close, and reopen. The text is still on disk.
6. Confirm no network access is requested.

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

Result: `src-tauri/target/release/bundle/deb/plainfold_0.1.0_amd64.deb`

Install test:

```sh
sudo dpkg -i src-tauri/target/release/bundle/deb/plainfold_0.1.0_amd64.deb
plainfold
```

Then repeat the open/create/edit/save checklist. Remove with `sudo apt remove plainfold`.

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

Result: `src-tauri/target/release/bundle/rpm/plainfold-0.1.0-1.x86_64.rpm`

Install test:

```sh
sudo dnf install ./src-tauri/target/release/bundle/rpm/plainfold-0.1.0-1.x86_64.rpm
plainfold
```

Then repeat the checklist. Remove with `sudo dnf remove plainfold`.

## CI

`.github/workflows/build.yml` runs:

- Windows: tests plus NSIS/MSI bundle.
- Ubuntu 22.04: tests plus `.deb`.
- Fedora container: tests plus `.rpm`.

Artifacts are uploaded per job. A release is only complete after the Windows, Debian-family, and Fedora-family install tests above have been performed on real machines or VMs.

Verification performed for this build:

- Windows: NSIS install, launch, and uninstall passed.
- Ubuntu 24.04 WSL (Debian family): `.deb` built, installed with `apt`, `ldd` reported no missing libraries, and removal succeeded.
- `.rpm` built from the same source with `rpmbuild`; metadata, dependencies, and file list were inspected. Installing it on Fedora remains a CI or VM step.

## Icons

The master icon is `assets/icon-master.png`. Regenerate all platform icons with:

```sh
npm run icon
```

`tauri icon` writes Windows, Linux, macOS, iOS, and Android sizes. Only Windows and Linux are shipped in v1.

## Bundle identifier and publisher

`src-tauri/tauri.conf.json` currently uses the placeholder `com.plainfold.app` and publisher `Plainfold`. Replace both with the owner's reverse-DNS identifier and legal publisher name before a public release. Changing the identifier later changes app data and config folders.
