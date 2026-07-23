mod classify;
mod db;
mod file_ops;
mod sound_lab;
mod translation;
mod waveform;

use db::{AppState, LibraryStats, ScanSummary, SearchRequest, SoundNameUpdate, SoundRow};
use file_ops::FileExport;
use sound_lab::{SoundLabExport, SoundLabSettings};
use std::path::PathBuf;
use tauri::{Manager, State};

#[tauri::command]
async fn scan_library(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<ScanSummary, String> {
    let db_path = state.db_path.clone();
    let root = PathBuf::from(path);
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || db::scan_library(&db_path, &root, &app))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn search_sounds(
    state: State<'_, AppState>,
    request: SearchRequest,
) -> Result<Vec<SoundRow>, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::search_sounds(&db_path, request))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_library_stats(state: State<'_, AppState>) -> Result<LibraryStats, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::get_stats(&db_path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_favorite(
    state: State<'_, AppState>,
    path: String,
    favorite: bool,
) -> Result<(), String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::set_favorite(&db_path, &path, favorite))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_waveform(path: String, bins: usize) -> Result<Vec<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || waveform::peaks(std::path::Path::new(&path), bins))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn translate_sound_name(
    state: State<'_, AppState>,
    path: String,
    original_name: String,
) -> Result<SoundNameUpdate, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let indexed_name = db::original_sound_name(&db_path, &path)?;
        if indexed_name != original_name {
            anyhow::bail!("索引中的音频名称已变化，请重新扫描后再翻译");
        }
        let translated = translation::translate_name(&original_name);
        if translated.trim() == original_name.trim() {
            anyhow::bail!("当前音频名称没有可翻译的英文语义");
        }
        db::set_sound_display_name(&db_path, &path, Some(&translated))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn export_selected_sound(
    input_path: String,
    output_path: String,
) -> Result<FileExport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        file_ops::copy_sound(
            std::path::Path::new(&input_path),
            std::path::Path::new(&output_path),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_sound_display_name(
    state: State<'_, AppState>,
    path: String,
    display_name: Option<String>,
) -> Result<SoundNameUpdate, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        db::set_sound_display_name(&db_path, &path, display_name.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn undo_sound_display_name(
    state: State<'_, AppState>,
    path: String,
) -> Result<SoundNameUpdate, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::undo_sound_display_name(&db_path, &path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn record_sound_played(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::record_sound_played(&db_path, &path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn remove_library(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::remove_library(&db_path, &path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| error.to_string())
}

#[tauri::command]
async fn export_sound_lab_audio(
    input_path: String,
    output_path: String,
    settings: SoundLabSettings,
) -> Result<SoundLabExport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sound_lab::export(
            std::path::Path::new(&input_path),
            std::path::Path::new(&output_path),
            settings,
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let db_path = app_data.join("sound-island.db");
            db::init_db(&db_path)?;
            for library in db::library_paths(&db_path).unwrap_or_default() {
                let _ = app.asset_protocol_scope().allow_directory(library, true);
            }
            app.manage(AppState { db_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_library,
            search_sounds,
            get_library_stats,
            set_favorite,
            get_waveform,
            translate_sound_name,
            set_sound_display_name,
            undo_sound_display_name,
            record_sound_played,
            export_selected_sound,
            remove_library,
            reveal_in_file_manager,
            export_sound_lab_audio
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Sound Island");
}
