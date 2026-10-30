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
pub mod revisions;
pub mod settings;
pub mod state;
pub mod tree;
pub mod undo;
pub mod repository;
pub mod watcher;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
