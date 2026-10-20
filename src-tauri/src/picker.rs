#[tauri::command]
pub async fn pick_add_items(app: tauri::AppHandle) -> Result<Vec<(String, bool)>, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_fs::FsExt;
        let (send, receive) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2_app_kit::NSOpenPanel;
            use objc2_foundation::NSString;
            let items = {
                let panel = NSOpenPanel::openPanel(MainThreadMarker::new().unwrap());
                panel.setTitle(Some(&NSString::from_str("选择要新增的文件或文件夹")));
                panel.setCanChooseFiles(true);
                panel.setCanChooseDirectories(true);
                panel.setAllowsMultipleSelection(true);
                panel.setResolvesAliases(true);
                if panel.runModal() == 1 {
                    panel.URLs().iter().filter_map(|url| url.path().map(|p| p.to_string())).collect::<Vec<_>>()
                } else {
                    Vec::new()
                }
            };
            let _ = send.send(items);
        }).map_err(|e| e.to_string())?;
        let paths = tauri::async_runtime::spawn_blocking(move || receive.recv())
            .await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
        let mut items = Vec::new();
        for path in paths {
            let is_dir = std::path::Path::new(&path).is_dir();
            if is_dir {
                app.fs_scope().allow_directory(&path, true).map_err(|e| e.to_string())?;
            } else {
                app.fs_scope().allow_file(&path).map_err(|e| e.to_string())?;
            }
            items.push((path, is_dir));
        }
        Ok(items)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("当前平台暂不支持混合选择文件和文件夹".into())
    }
}
