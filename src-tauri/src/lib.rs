pub mod atomic;
pub mod commands;
pub mod encoding;
pub mod errors;
pub mod index;
pub mod log;
pub mod names;
pub mod paths;
pub mod settings;
pub mod state;
pub mod tree;
pub mod vault;
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
            commands::open_vault,
            commands::list_tree,
            commands::read_file,
            commands::save_file,
            commands::create_item,
            commands::delete_item,
            commands::search,
            commands::rescan,
            commands::get_organization,
            commands::set_tags,
            commands::set_pin,
            commands::set_sort_order,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("Plainfold could not start");
}
