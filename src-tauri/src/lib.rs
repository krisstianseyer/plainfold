pub mod atomic;
pub mod commands;
pub mod desktop;
pub mod encoding;
pub mod errors;
pub mod filetype;
pub mod index;
pub mod log;
pub mod names;
pub mod paths;
pub mod repository;
pub mod revisions;
pub mod settings;
pub mod state;
pub mod tree;
pub mod undo;
pub mod watcher;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use crate::state::AppState;

/// A panic during startup used to terminate the release build silently because
/// it runs as a Windows GUI subsystem process. Show the panic text in a native
/// message box so a failed launch is never just a window that never appears.
#[cfg(windows)]
fn show_panic_message(message: &str) {
    use std::os::windows::ffi::OsStrExt;

    let text: Vec<u16> = std::ffi::OsStr::new(message)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let caption: Vec<u16> = "Plainfold"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            u_type: u32,
        ) -> i32;
    }

    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            0x0000_0010, // MB_OK | MB_ICONERROR
        );
    }
}

#[cfg(not(windows))]
fn show_panic_message(_message: &str) {}

fn install_panic_message_box() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let exe = std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| "Plainfold.exe".into());
        let detail = info.to_string();
        let hint = if detail.contains("WebView2") || detail.contains("0x800700AA") {
            "\n\nThe WebView2 browser process could not start. This can happen when the \
             executable is in a folder marked with a low integrity level, or when another \
             Edge/WebView2 process is running elevated."
        } else {
            ""
        };
        let message = format!(
            "Plainfold could not start.\n\n{detail}{hint}\n\nExecutable:\n{exe}\n\n\
             If this is a WebView2 launch failure, try:\n  icacls \"{exe}\" /setintegritylevel Medium"
        );
        show_panic_message(&message);
        previous_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_message_box();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let fallback = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| fallback.join("config"));
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| fallback.join("data"));
            log::init(&data_dir);
            app.manage(Arc::new(AppState::new(config_dir, data_dir)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::open_repository,
            commands::list_tree,
            commands::read_file,
            commands::open_external,
            commands::open_update_page,
            commands::open_support_page,
            commands::list_revisions,
            commands::restore_revision,
            commands::save_file,
            commands::create_item,
            commands::move_item,
            commands::delete_item,
            commands::search,
            commands::rescan,
            commands::get_organization,
            commands::remove_recent,
            commands::set_tags,
            commands::set_pin,
            commands::set_sort_order,
            commands::desktop_shortcut_status,
            commands::resolve_desktop_shortcut,
            commands::save_settings,
            commands::remove_recent_repository,
            commands::undo_state,
            commands::undo,
            commands::redo,
        ])
        .run(tauri::generate_context!())
        .expect("Plainfold could not start");
}
