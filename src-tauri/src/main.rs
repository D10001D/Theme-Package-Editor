#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod picker;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![picker::pick_add_items])
    .run(tauri::generate_context!())
    .expect("error while running Theme Package Editor");
}
