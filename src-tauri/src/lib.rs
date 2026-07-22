use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager, RunEvent, State,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPayload {
    path: String,
    name: String,
    contents: String,
}

#[derive(Default)]
struct PendingDocument(Mutex<Option<DocumentPayload>>);

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
fn initial_document(
    pending: State<'_, PendingDocument>,
) -> Result<Option<DocumentPayload>, String> {
    if let Some(document) = pending
        .0
        .lock()
        .map_err(|_| "Could not access the pending document".to_owned())?
        .take()
    {
        return Ok(Some(document));
    }

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

#[tauri::command]
fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(|webview| unsafe {
                use objc2_app_kit::{NSPrintInfo, NSWindow};
                use objc2_web_kit::WKWebView;

                let view: &WKWebView = &*webview.inner().cast();
                let native_window: &NSWindow = &*webview.ns_window().cast();
                let print_info = NSPrintInfo::sharedPrintInfo();
                let print_operation = view.printOperationWithPrintInfo(&print_info);

                print_operation.setCanSpawnSeparateThread(true);
                print_operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    native_window,
                    None,
                    None,
                    std::ptr::null_mut(),
                );
            })
            .map_err(|error| format!("Could not open the print dialog: {error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    window
        .eval("window.print()")
        .map_err(|error| format!("Could not open the print dialog: {error}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(PendingDocument::default())
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
            write_document,
            print_document
        ])
        .build(tauri::generate_context!())
        .expect("error while building mdview");

    app.run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let RunEvent::Opened { urls } = event {
            let Some(path) = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .find(|path| path.is_file() && is_markdown(path))
            else {
                return;
            };

            if let Ok(document) = load_document(&path) {
                if let Ok(mut pending) = app.state::<PendingDocument>().0.lock() {
                    *pending = Some(document.clone());
                }
                let _ = app.emit("open-document", document);
            }
        }
    });
}
