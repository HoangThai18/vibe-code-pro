// src-tauri/src/lib.rs
use tauri_plugin_dialog::DialogExt;

const MAX_CSV_BYTES: u64 = 5 * 1024 * 1024;

// Renderer không gửi đường dẫn: command tự mở hộp thoại chọn file
#[tauri::command]
async fn import_customers_csv(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().add_filter("CSV", &["csv"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_CSV_BYTES {
        return Err("File lớn hơn 5 MB".into());
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![import_customers_csv])
        .run(tauri::generate_context!())
        .expect("không khởi động được app");
}
