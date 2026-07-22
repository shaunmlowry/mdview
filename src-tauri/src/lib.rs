use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPayload {
    path: String,
    name: String,
    contents: String,
}

fn load_document(path: &Path) -> Result<DocumentPayload, String> {
    if !path.is_file() {
        return Err(format!("File not found: {}", path.display()));
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_owned();

    Ok(DocumentPayload {
        path: path.to_string_lossy().into_owned(),
        name,
        contents,
    })
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd" | "mdx"
            )
        })
}

#[tauri::command]
fn initial_document() -> Result<Option<DocumentPayload>, String> {
    env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.is_file() && is_markdown(path))
        .map(|path| load_document(&path))
        .transpose()
}

#[tauri::command]
fn read_document(path: String) -> Result<DocumentPayload, String> {
    load_document(Path::new(&path))
}

#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|error| format!("Could not write {path}: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let open = MenuItemBuilder::with_id("open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save = MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let export_html =
                MenuItemBuilder::with_id("export-html", "Export HTML...").build(app)?;
            let export_pdf = MenuItemBuilder::with_id("export-pdf", "Export PDF...").build(app)?;
            let toggle_editor = MenuItemBuilder::with_id("toggle-editor", "Toggle Editor")
                .accelerator("CmdOrCtrl+E")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open)
                .item(&save)
                .separator()
                .item(&export_html)
                .item(&export_pdf)
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_editor)
                .build()?;
            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&view_menu)
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            initial_document,
            read_document,
            write_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running mdview");
}
