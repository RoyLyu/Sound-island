use crate::classify::classify;
use anyhow::{Context, Result};
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use symphonia::core::{
    formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundRow {
    path: String,
    name: String,
    display_name: Option<String>,
    can_undo_name: bool,
    extension: String,
    file_size: i64,
    modified_at: i64,
    category: String,
    subcategory: String,
    tags: Vec<String>,
    library_path: String,
    library_name: String,
    favorite: bool,
    duration: Option<f64>,
    sample_rate: Option<i64>,
    channels: Option<i64>,
    bit_depth: Option<i64>,
    last_played_at: Option<i64>,
    play_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub scope: Option<String>,
    pub category: Option<String>,
    pub subcategory: Option<String>,
    pub collection: Option<String>,
    pub favorites_only: bool,
    pub library_path: Option<String>,
    #[serde(default)]
    pub folder_path: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolderRow {
    path: String,
    name: String,
    sound_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRow {
    path: String,
    name: String,
    sound_count: i64,
    added_at: i64,
    child_folders: Vec<LibraryFolderRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    total: i64,
    total_bytes: i64,
    favorites: i64,
    categories: std::collections::BTreeMap<String, i64>,
    subcategories: std::collections::BTreeMap<String, std::collections::BTreeMap<String, i64>>,
    smart_collections: std::collections::BTreeMap<String, i64>,
    libraries: Vec<LibraryRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundNameUpdate {
    display_name: Option<String>,
    can_undo_name: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    library_path: String,
    library_name: String,
    scanned: usize,
    added: usize,
    updated: usize,
    skipped: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    library_path: String,
    processed: usize,
    discovered: usize,
    current_file: String,
}

#[derive(Default)]
struct AudioMetadata {
    duration: Option<f64>,
    sample_rate: Option<i64>,
    channels: Option<i64>,
    bit_depth: Option<i64>,
}

pub fn init_db(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("create application data directory")?;
    }
    let connection = Connection::open(path).context("open SQLite index")?;
    connection.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS libraries (
          path TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          added_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sounds (
          path TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          display_name TEXT,
          previous_display_name TEXT,
          extension TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          modified_at INTEGER NOT NULL,
          category TEXT NOT NULL,
          subcategory TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          library_path TEXT NOT NULL REFERENCES libraries(path) ON DELETE CASCADE,
          favorite INTEGER NOT NULL DEFAULT 0,
          duration REAL,
          sample_rate INTEGER,
          channels INTEGER,
          bit_depth INTEGER,
          last_played_at INTEGER,
          play_count INTEGER NOT NULL DEFAULT 0,
          last_seen_scan INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_sounds_category ON sounds(category);
        CREATE INDEX IF NOT EXISTS idx_sounds_library ON sounds(library_path);
        CREATE INDEX IF NOT EXISTS idx_sounds_favorite ON sounds(favorite);
        CREATE INDEX IF NOT EXISTS idx_sounds_modified ON sounds(modified_at);

        CREATE VIRTUAL TABLE IF NOT EXISTS sounds_fts USING fts5(
          name, path, category, subcategory, tags,
          content='sounds', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
        );

        CREATE TRIGGER IF NOT EXISTS sounds_ai AFTER INSERT ON sounds BEGIN
          INSERT INTO sounds_fts(rowid, name, path, category, subcategory, tags)
          VALUES (new.rowid, new.name, new.path, new.category, new.subcategory, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS sounds_ad AFTER DELETE ON sounds BEGIN
          INSERT INTO sounds_fts(sounds_fts, rowid, name, path, category, subcategory, tags)
          VALUES ('delete', old.rowid, old.name, old.path, old.category, old.subcategory, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS sounds_au AFTER UPDATE ON sounds BEGIN
          INSERT INTO sounds_fts(sounds_fts, rowid, name, path, category, subcategory, tags)
          VALUES ('delete', old.rowid, old.name, old.path, old.category, old.subcategory, old.tags);
          INSERT INTO sounds_fts(rowid, name, path, category, subcategory, tags)
          VALUES (new.rowid, new.name, new.path, new.category, new.subcategory, new.tags);
        END;
        "#,
    )?;
    ensure_sound_column(&connection, "display_name", "TEXT")?;
    ensure_sound_column(&connection, "previous_display_name", "TEXT")?;
    ensure_sound_column(&connection, "last_played_at", "INTEGER")?;
    ensure_sound_column(&connection, "play_count", "INTEGER NOT NULL DEFAULT 0")?;
    connection.execute("DELETE FROM sounds WHERE name LIKE '._%'", [])?;
    Ok(())
}

fn ensure_sound_column(connection: &Connection, name: &str, definition: &str) -> Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(sounds)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !columns.iter().any(|column| column == name) {
        connection.execute_batch(&format!(
            "ALTER TABLE sounds ADD COLUMN {name} {definition}"
        ))?;
    }
    Ok(())
}

fn open_db(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.busy_timeout(std::time::Duration::from_secs(15))?;
    Ok(connection)
}

pub fn library_paths(path: &Path) -> Result<Vec<PathBuf>> {
    let connection = open_db(path)?;
    let mut statement = connection.prepare("SELECT path FROM libraries ORDER BY added_at")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.filter_map(|row| row.ok()).map(PathBuf::from).collect())
}

fn supported_audio(path: &Path) -> bool {
    if path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with("._"))
    {
        return false;
    }
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("wav" | "wave" | "aif" | "aiff" | "flac" | "mp3" | "m4a" | "ogg")
    )
}

fn modified_millis(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn probe_audio(path: &Path) -> AudioMetadata {
    let Ok(file) = File::open(path) else {
        return AudioMetadata::default();
    };
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let Ok(probed) = symphonia::default::get_probe().format(
        &hint,
        stream,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) else {
        return AudioMetadata::default();
    };
    let Some(track) = probed.format.default_track() else {
        return AudioMetadata::default();
    };
    let params = &track.codec_params;
    let duration = params
        .time_base
        .zip(params.n_frames)
        .map(|(time_base, frames)| {
            let time = time_base.calc_time(frames);
            time.seconds as f64 + time.frac
        });
    AudioMetadata {
        duration,
        sample_rate: params.sample_rate.map(i64::from),
        channels: params.channels.map(|channels| channels.count() as i64),
        bit_depth: params.bits_per_sample.map(i64::from),
    }
}

pub fn scan_library(db_path: &Path, root: &Path, app: &AppHandle) -> Result<ScanSummary> {
    let root = root.canonicalize().context("素材库路径不存在或无法读取")?;
    if !root.is_dir() {
        anyhow::bail!("选择的路径不是文件夹");
    }

    let files: Vec<PathBuf> = WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file() && supported_audio(entry.path()))
        .map(|entry| entry.into_path())
        .collect();

    let library_path = root.to_string_lossy().into_owned();
    let library_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(&library_path)
        .to_string();
    let scan_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .min(i64::MAX as u128) as i64;
    let mut connection = open_db(db_path)?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO libraries(path, name, added_at) VALUES (?1, ?2, ?3) ON CONFLICT(path) DO UPDATE SET name=excluded.name",
        params![library_path, library_name, scan_id],
    )?;

    let mut added = 0usize;
    let mut updated = 0usize;
    let mut skipped = 0usize;

    for (index, path) in files.iter().enumerate() {
        let metadata = match path.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let path_string = path.to_string_lossy().into_owned();
        let file_size = metadata.len().min(i64::MAX as u64) as i64;
        let modified_at = modified_millis(&metadata);
        let existing = transaction
            .query_row(
                "SELECT file_size, modified_at FROM sounds WHERE path=?1",
                params![path_string],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;

        if existing == Some((file_size, modified_at)) {
            transaction.execute(
                "UPDATE sounds SET last_seen_scan=?2 WHERE path=?1",
                params![path_string, scan_id],
            )?;
            skipped += 1;
        } else {
            let classification = classify(path);
            let audio = probe_audio(path);
            let name = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let tags = serde_json::to_string(&classification.tags)?;
            transaction.execute(
                r#"
                INSERT INTO sounds(path, name, extension, file_size, modified_at, category, subcategory, tags,
                  library_path, duration, sample_rate, channels, bit_depth, last_seen_scan)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                ON CONFLICT(path) DO UPDATE SET
                  name=excluded.name, extension=excluded.extension, file_size=excluded.file_size,
                  modified_at=excluded.modified_at, category=excluded.category, subcategory=excluded.subcategory,
                  tags=excluded.tags, library_path=excluded.library_path, duration=excluded.duration,
                  sample_rate=excluded.sample_rate, channels=excluded.channels, bit_depth=excluded.bit_depth,
                  last_seen_scan=excluded.last_seen_scan
                "#,
                params![
                    path_string, name, extension, file_size, modified_at, classification.category,
                    classification.subcategory, tags, library_path, audio.duration,
                    audio.sample_rate, audio.channels, audio.bit_depth, scan_id
                ],
            )?;
            if existing.is_some() {
                updated += 1;
            } else {
                added += 1;
            }
        }

        if index % 100 == 0 || index + 1 == files.len() {
            let _ = app.emit(
                "scan-progress",
                ScanProgress {
                    library_path: library_path.clone(),
                    processed: index + 1,
                    discovered: files.len(),
                    current_file: path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_string(),
                },
            );
        }
    }

    transaction.execute(
        "DELETE FROM sounds WHERE library_path=?1 AND last_seen_scan<>?2",
        params![library_path, scan_id],
    )?;
    transaction.commit()?;

    Ok(ScanSummary {
        library_path,
        library_name,
        scanned: files.len(),
        added,
        updated,
        skipped,
    })
}

fn search_terms(query: &str, scope: Option<&str>) -> String {
    let synonyms: &[(&str, &[&str])] = &[
        ("雨", &["rain", "storm", "wet"]),
        ("脚步", &["footstep", "steps", "boots"]),
        (
            "摩擦",
            &["friction", "rub", "rubbing", "scrape", "rustle", "cloth"],
        ),
        ("撞击", &["impact", "hit", "slam", "crash", "thud"]),
        ("门", &["door", "gate", "latch"]),
        ("怪兽", &["creature", "monster", "growl"]),
        ("转场", &["whoosh", "transition", "riser"]),
        ("车", &["car", "vehicle", "engine"]),
        ("枪", &["gun", "rifle", "pistol", "shot"]),
        ("火焰", &["fire", "flame", "crackle"]),
        ("人群", &["crowd", "people", "market"]),
        ("玻璃", &["glass", "shatter", "break"]),
        ("环境", &["ambience", "ambient", "atmosphere"]),
    ];
    let mut terms: Vec<String> = query
        .split_whitespace()
        .map(|term| term.trim_matches(|character: char| !character.is_alphanumeric()))
        .filter(|term| !term.is_empty())
        .map(str::to_lowercase)
        .collect();
    for (source, expanded) in synonyms {
        if query.contains(source) {
            terms.extend(expanded.iter().map(|term| term.to_string()));
        }
    }
    terms.sort();
    terms.dedup();
    let columns: &[&str] = match scope {
        Some("name") => &["name"],
        Some("category") => &["category", "subcategory"],
        Some("tags") => &["tags"],
        Some("path") => &["path"],
        _ => &[],
    };
    terms
        .into_iter()
        .flat_map(|term| {
            let term = term.replace('"', "");
            if columns.is_empty() {
                vec![format!("\"{term}\"*")]
            } else {
                columns
                    .iter()
                    .map(|column| format!("{column}:\"{term}\"*"))
                    .collect()
            }
        })
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn escape_like(value: &str) -> String {
    value
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_")
}

fn sound_from_row(row: &Row<'_>) -> rusqlite::Result<SoundRow> {
    let tags_json: String = row.get(9)?;
    Ok(SoundRow {
        path: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        can_undo_name: row.get::<_, Option<String>>(3)?.is_some(),
        extension: row.get(4)?,
        file_size: row.get(5)?,
        modified_at: row.get(6)?,
        category: row.get(7)?,
        subcategory: row.get(8)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        library_path: row.get(10)?,
        library_name: row.get(11)?,
        favorite: row.get::<_, i64>(12)? != 0,
        duration: row.get(13)?,
        sample_rate: row.get(14)?,
        channels: row.get(15)?,
        bit_depth: row.get(16)?,
        last_played_at: row.get(17)?,
        play_count: row.get(18)?,
    })
}

pub fn search_sounds(db_path: &Path, request: SearchRequest) -> Result<Vec<SoundRow>> {
    let connection = open_db(db_path)?;
    let scope = request.scope.as_deref();
    let fts_query = search_terms(&request.query, scope);
    let has_query = !fts_query.is_empty();
    let mut sql = String::from(
        "SELECT s.path, s.name, s.display_name, s.previous_display_name, s.extension, s.file_size, s.modified_at, s.category, s.subcategory, s.tags, s.library_path, l.name, s.favorite, s.duration, s.sample_rate, s.channels, s.bit_depth, s.last_played_at, s.play_count FROM sounds s JOIN libraries l ON l.path=s.library_path "
    );
    sql.push_str("WHERE 1=1 ");
    let mut values: Vec<Value> = Vec::new();
    if has_query {
        sql.push_str("AND (s.rowid IN (SELECT rowid FROM sounds_fts WHERE sounds_fts MATCH ?) ");
        values.push(fts_query.into());
        if matches!(scope, None | Some("all") | Some("name")) {
            sql.push_str("OR COALESCE(s.display_name,'') LIKE ? ");
            values.push(format!("%{}%", request.query.trim()).into());
        }
        sql.push_str(") ");
    }
    if let Some(category) = request.category.filter(|value| !value.is_empty()) {
        sql.push_str("AND s.category=? ");
        values.push(category.into());
    }
    if let Some(subcategory) = request.subcategory.filter(|value| !value.is_empty()) {
        sql.push_str("AND s.subcategory=? ");
        values.push(subcategory.into());
    }
    if request.favorites_only {
        sql.push_str("AND s.favorite=1 ");
    }
    if let Some(library_path) = request.library_path.filter(|value| !value.is_empty()) {
        sql.push_str("AND s.library_path=? ");
        values.push(library_path.into());
    }
    if let Some(folder_path) = request.folder_path.filter(|value| !value.is_empty()) {
        sql.push_str("AND s.path LIKE ? ESCAPE '!' ");
        values.push(
            format!(
                "{}{}%",
                escape_like(&folder_path),
                std::path::MAIN_SEPARATOR
            )
            .into(),
        );
    }
    match request.collection.as_deref() {
        Some("recently_played") => sql.push_str("AND s.last_played_at IS NOT NULL "),
        Some("short") => sql.push_str("AND s.duration IS NOT NULL AND s.duration<=10 "),
        Some("high_res") => sql.push_str("AND s.sample_rate>=96000 "),
        Some("needs_translation") => sql.push_str(
            "AND (s.display_name IS NULL OR s.display_name='') AND s.name GLOB '*[A-Za-z]*' ",
        ),
        _ => {}
    }
    if !has_query && request.collection.as_deref() == Some("recently_played") {
        sql.push_str("ORDER BY s.last_played_at DESC ");
    } else {
        sql.push_str("ORDER BY COALESCE(s.display_name,s.name) COLLATE NOCASE ");
    }
    sql.push_str("LIMIT ? OFFSET ?");
    values.push(request.limit.clamp(1, 1000).into());
    values.push(request.offset.max(0).into());
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values), sound_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_stats(db_path: &Path) -> Result<LibraryStats> {
    let connection = open_db(db_path)?;
    let (total, total_bytes, favorites) = connection.query_row(
        "SELECT COUNT(*), COALESCE(SUM(file_size),0), COALESCE(SUM(favorite),0) FROM sounds",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let mut categories = std::collections::BTreeMap::new();
    let mut category_statement =
        connection.prepare("SELECT category, COUNT(*) FROM sounds GROUP BY category")?;
    for row in category_statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })? {
        let (category, count) = row?;
        categories.insert(category, count);
    }
    let mut subcategories = std::collections::BTreeMap::new();
    let mut subcategory_statement = connection.prepare("SELECT category, subcategory, COUNT(*) FROM sounds GROUP BY category, subcategory ORDER BY category, COUNT(*) DESC")?;
    for row in subcategory_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })? {
        let (category, subcategory, count) = row?;
        subcategories
            .entry(category)
            .or_insert_with(std::collections::BTreeMap::new)
            .insert(subcategory, count);
    }
    let mut smart_collections = std::collections::BTreeMap::new();
    let smart_counts: (i64, i64, i64, i64) = connection.query_row(
        "SELECT COALESCE(SUM(last_played_at IS NOT NULL),0), COALESCE(SUM(duration IS NOT NULL AND duration<=10),0), COALESCE(SUM(sample_rate>=96000),0), COALESCE(SUM((display_name IS NULL OR display_name='') AND name GLOB '*[A-Za-z]*'),0) FROM sounds",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    smart_collections.insert("recently_played".into(), smart_counts.0);
    smart_collections.insert("short".into(), smart_counts.1);
    smart_collections.insert("high_res".into(), smart_counts.2);
    smart_collections.insert("needs_translation".into(), smart_counts.3);
    let mut library_statement = connection.prepare(
        "SELECT l.path, l.name, COUNT(s.path), l.added_at FROM libraries l LEFT JOIN sounds s ON s.library_path=l.path GROUP BY l.path ORDER BY l.added_at DESC"
    )?;
    let mut libraries = library_statement
        .query_map([], |row| {
            Ok(LibraryRow {
                path: row.get(0)?,
                name: row.get(1)?,
                sound_count: row.get(2)?,
                added_at: row.get(3)?,
                child_folders: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(library_statement);
    for library in &mut libraries {
        let root = Path::new(&library.path);
        let mut folders = std::collections::BTreeMap::<String, (String, i64)>::new();
        let mut statement = connection.prepare("SELECT path FROM sounds WHERE library_path=?1")?;
        let rows = statement.query_map(params![library.path], |row| row.get::<_, String>(0))?;
        for sound_path in rows {
            let sound_path = PathBuf::from(sound_path?);
            let Ok(relative) = sound_path.strip_prefix(root) else {
                continue;
            };
            let mut components = relative.components();
            let Some(first) = components.next() else {
                continue;
            };
            if components.next().is_none() {
                continue;
            }
            let name = first.as_os_str().to_string_lossy().into_owned();
            let child_path = root.join(first.as_os_str()).to_string_lossy().into_owned();
            let entry = folders.entry(name).or_insert((child_path, 0));
            entry.1 += 1;
        }
        library.child_folders = folders
            .into_iter()
            .map(|(name, (path, sound_count))| LibraryFolderRow {
                path,
                name,
                sound_count,
            })
            .collect();
    }
    Ok(LibraryStats {
        total,
        total_bytes,
        favorites,
        categories,
        subcategories,
        smart_collections,
        libraries,
    })
}

pub fn set_favorite(db_path: &Path, path: &str, favorite: bool) -> Result<()> {
    let connection = open_db(db_path)?;
    connection.execute(
        "UPDATE sounds SET favorite=?2 WHERE path=?1",
        params![path, favorite as i64],
    )?;
    Ok(())
}

pub fn original_sound_name(db_path: &Path, path: &str) -> Result<String> {
    let connection = open_db(db_path)?;
    Ok(connection.query_row(
        "SELECT name FROM sounds WHERE path=?1",
        params![path],
        |row| row.get(0),
    )?)
}

pub fn set_sound_display_name(
    db_path: &Path,
    path: &str,
    display_name: Option<&str>,
) -> Result<SoundNameUpdate> {
    let connection = open_db(db_path)?;
    let normalized = display_name.map(str::trim).filter(|name| !name.is_empty());
    connection.execute(
        "UPDATE sounds SET previous_display_name=COALESCE(display_name,''), display_name=?2 WHERE path=?1",
        params![path, normalized],
    )?;
    sound_name_update(&connection, path)
}

pub fn undo_sound_display_name(db_path: &Path, path: &str) -> Result<SoundNameUpdate> {
    let connection = open_db(db_path)?;
    connection.execute(
        "UPDATE sounds SET display_name=NULLIF(previous_display_name,''), previous_display_name=COALESCE(display_name,'') WHERE path=?1 AND previous_display_name IS NOT NULL",
        params![path],
    )?;
    sound_name_update(&connection, path)
}

fn sound_name_update(connection: &Connection, path: &str) -> Result<SoundNameUpdate> {
    Ok(connection.query_row(
        "SELECT display_name, previous_display_name IS NOT NULL FROM sounds WHERE path=?1",
        params![path],
        |row| {
            Ok(SoundNameUpdate {
                display_name: row.get(0)?,
                can_undo_name: row.get::<_, i64>(1)? != 0,
            })
        },
    )?)
}

pub fn record_sound_played(db_path: &Path, path: &str) -> Result<()> {
    let connection = open_db(db_path)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .min(i64::MAX as u128) as i64;
    connection.execute(
        "UPDATE sounds SET last_played_at=?2, play_count=play_count+1 WHERE path=?1",
        params![path, now],
    )?;
    Ok(())
}

pub fn remove_library(db_path: &Path, path: &str) -> Result<()> {
    let mut connection = open_db(db_path)?;
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM sounds WHERE library_path=?1", params![path])?;
    transaction.execute("DELETE FROM libraries WHERE path=?1", params![path])?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DB_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn test_db() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = TEST_DB_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "sound-island-{}-{suffix}-{sequence}.db",
            std::process::id()
        ));
        init_db(&path).unwrap();
        let connection = open_db(&path).unwrap();
        connection
            .execute(
                "INSERT INTO libraries(path,name,added_at) VALUES('/test','Test',1)",
                [],
            )
            .unwrap();
        connection.execute(
            "INSERT INTO sounds(path,name,extension,file_size,modified_at,category,subcategory,tags,library_path,last_seen_scan) VALUES('/test/body.wav','body falls hard','wav',1,1,'拟音 Foley','身体 / Body','[]','/test',1)",
            [],
        ).unwrap();
        path
    }

    #[test]
    fn display_name_can_undo_to_original_and_redo() {
        let path = test_db();
        let translated = set_sound_display_name(&path, "/test/body.wav", Some("身体重摔")).unwrap();
        assert_eq!(translated.display_name.as_deref(), Some("身体重摔"));
        assert!(translated.can_undo_name);
        let connection = open_db(&path).unwrap();
        let source_identity: (String, String) = connection
            .query_row(
                "SELECT path, name FROM sounds WHERE path='/test/body.wav'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            source_identity,
            ("/test/body.wav".into(), "body falls hard".into())
        );

        let original = undo_sound_display_name(&path, "/test/body.wav").unwrap();
        assert_eq!(original.display_name, None);
        assert!(original.can_undo_name);

        let redone = undo_sound_display_name(&path, "/test/body.wav").unwrap();
        assert_eq!(redone.display_name.as_deref(), Some("身体重摔"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn ignores_macos_resource_fork_audio_files() {
        assert!(!supported_audio(Path::new("._hidden.wav")));
        assert!(supported_audio(Path::new("visible.wav")));
    }

    #[test]
    fn exposes_immediate_library_folders_and_filters_by_folder() {
        let path = test_db();
        let connection = open_db(&path).unwrap();
        connection.execute(
            "INSERT INTO sounds(path,name,extension,file_size,modified_at,category,subcategory,tags,library_path,last_seen_scan) VALUES('/test/Doors/open.wav','open','wav',1,1,'硬音效 Hard FX','门窗 / Doors','[]','/test',1)",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO sounds(path,name,extension,file_size,modified_at,category,subcategory,tags,library_path,last_seen_scan) VALUES('/test/Doors/Metal/close.wav','close','wav',1,1,'硬音效 Hard FX','门窗 / Doors','[]','/test',1)",
            [],
        ).unwrap();
        drop(connection);

        let stats = get_stats(&path).unwrap();
        assert_eq!(stats.libraries[0].child_folders.len(), 1);
        assert_eq!(stats.libraries[0].child_folders[0].name, "Doors");
        assert_eq!(stats.libraries[0].child_folders[0].sound_count, 2);

        let results = search_sounds(
            &path,
            SearchRequest {
                query: String::new(),
                scope: Some("all".into()),
                category: None,
                subcategory: None,
                collection: None,
                favorites_only: false,
                library_path: Some("/test".into()),
                folder_path: Some("/test/Doors".into()),
                limit: 20,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(results.len(), 2);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn scopes_search_to_name_or_category() {
        let path = test_db();
        let request = |query: &str, scope: &str| SearchRequest {
            query: query.into(),
            scope: Some(scope.into()),
            category: None,
            subcategory: None,
            collection: None,
            favorites_only: false,
            library_path: None,
            folder_path: None,
            limit: 20,
            offset: 0,
        };
        assert_eq!(
            search_sounds(&path, request("body", "name")).unwrap().len(),
            1
        );
        assert!(search_sounds(&path, request("falls", "category"))
            .unwrap()
            .is_empty());
        assert_eq!(
            search_sounds(&path, request("身体", "category"))
                .unwrap()
                .len(),
            1
        );
        let _ = std::fs::remove_file(path);
    }
}
