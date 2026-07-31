use serde::Serialize;
use std::{
    collections::HashMap,
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID},
    AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPayload {
    path: String,
    name: String,
    contents: String,
}

#[derive(Default)]
struct DocumentWindows(Mutex<DocumentWindowRegistry>);

struct DocumentWindowRegistry {
    windows: HashMap<String, Option<DocumentPayload>>,
    paths: HashMap<PathBuf, String>,
    next_window_id: u64,
}

impl Default for DocumentWindowRegistry {
    fn default() -> Self {
        Self {
            windows: HashMap::from([("main".to_owned(), None)]),
            paths: HashMap::new(),
            next_window_id: 0,
        }
    }
}

impl DocumentWindowRegistry {
    fn register_blank(&mut self, label: &str) {
        self.windows.entry(label.to_owned()).or_insert(None);
    }

    fn assign(&mut self, label: &str, document: DocumentPayload) {
        if let Some(Some(previous)) = self.windows.get(label) {
            self.paths.remove(Path::new(&previous.path));
        }

        self.paths
            .insert(PathBuf::from(&document.path), label.to_owned());
        self.windows.insert(label.to_owned(), Some(document));
    }

    fn document(&self, label: &str) -> Option<&DocumentPayload> {
        self.windows.get(label).and_then(Option::as_ref)
    }

    fn window_for_path(&self, path: &Path) -> Option<&str> {
        self.paths.get(path).map(String::as_str)
    }

    fn blank_window(&self) -> Option<&str> {
        if self.windows.get("main").is_some_and(Option::is_none) {
            return Some("main");
        }

        self.windows
            .iter()
            .filter(|(_, document)| document.is_none())
            .map(|(label, _)| label.as_str())
            .min()
    }

    fn next_label(&mut self) -> String {
        loop {
            self.next_window_id += 1;
            let label = format!("document-{}", self.next_window_id);
            if !self.windows.contains_key(&label) {
                return label;
            }
        }
    }

    fn remove(&mut self, label: &str) {
        if let Some(Some(document)) = self.windows.remove(label) {
            self.paths.remove(Path::new(&document.path));
        }
    }
}

fn load_document(path: &Path) -> Result<DocumentPayload, String> {
    if !path.is_file() {
        return Err(format!("File not found: {}", path.display()));
    }

    if !is_markdown(path) {
        return Err(format!("Not a Markdown document: {}", path.display()));
    }

    let path = fs::canonicalize(path)
        .map_err(|error| format!("Could not resolve {}: {error}", path.display()))?;
    let contents = fs::read_to_string(&path)
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

fn command_line_document_paths() -> impl Iterator<Item = PathBuf> {
    env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| path.is_file() && is_markdown(path))
}

fn create_window_from_config(
    app: &AppHandle,
    label: &str,
    title: &str,
) -> Result<WebviewWindow, String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "No document window configuration is available".to_owned())?;
    config.label = label.to_owned();
    config.title = title.to_owned();
    config.center = false;

    let existing_windows = app.webview_windows();
    let origin = existing_windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| existing_windows.values().next());
    if let Some(origin) = origin {
        if let (Ok(position), Ok(scale_factor)) = (origin.outer_position(), origin.scale_factor()) {
            config.x = Some(position.x as f64 / scale_factor + 24.0);
            config.y = Some(position.y as f64 / scale_factor + 24.0);
        }
    }

    WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| format!("Could not configure a document window: {error}"))?
        .build()
        .map_err(|error| format!("Could not open a document window: {error}"))
}

fn focus_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Document window {label} is not available"))?;
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|error| format!("Could not focus the document window: {error}"))
}

fn open_document_path(
    app: &AppHandle,
    path: &Path,
    preferred_blank: Option<&str>,
) -> Result<(), String> {
    let document = load_document(path)?;
    let canonical_path = Path::new(&document.path);
    let state = app.state::<DocumentWindows>();

    enum Destination {
        Existing(String),
        Blank(String),
        New(String),
    }

    let destination = {
        let mut registry = state
            .0
            .lock()
            .map_err(|_| "Could not access the document windows".to_owned())?;

        if let Some(label) = registry.window_for_path(canonical_path) {
            Destination::Existing(label.to_owned())
        } else if let Some(label) = preferred_blank
            .filter(|label| registry.windows.get(*label).is_some_and(Option::is_none))
            .map(str::to_owned)
            .or_else(|| registry.blank_window().map(str::to_owned))
        {
            registry.assign(&label, document.clone());
            Destination::Blank(label)
        } else {
            let label = registry.next_label();
            registry.register_blank(&label);
            registry.assign(&label, document.clone());
            Destination::New(label)
        }
    };

    match destination {
        Destination::Existing(label) => focus_window(app, &label),
        Destination::Blank(label) => {
            let Some(window) = app.get_webview_window(&label) else {
                return Ok(());
            };
            window
                .set_title(&document.name)
                .map_err(|error| format!("Could not update the window title: {error}"))?;
            app.emit_to(&label, "open-document", document)
                .map_err(|error| format!("Could not send the document to its window: {error}"))?;
            focus_window(app, &label)
        }
        Destination::New(label) => {
            if let Err(error) = create_window_from_config(app, &label, &document.name) {
                if let Ok(mut registry) = state.0.lock() {
                    registry.remove(&label);
                }
                return Err(error);
            }
            focus_window(app, &label)
        }
    }
}

fn create_blank_window(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<DocumentWindows>();
    let label = {
        let mut registry = state
            .0
            .lock()
            .map_err(|_| "Could not access the document windows".to_owned())?;
        let label = registry.next_label();
        registry.register_blank(&label);
        label
    };

    if let Err(error) = create_window_from_config(app, &label, "mdview") {
        if let Ok(mut registry) = state.0.lock() {
            registry.remove(&label);
        }
        return Err(error);
    }

    focus_window(app, &label)
}

fn run_filter_command(
    command: &str,
    input: &str,
    document_path: Option<&str>,
) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Filter command cannot be empty".to_owned());
    }

    let mut process = Command::new("/bin/zsh");
    process
        .args(["-lc", command])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(directory) = document_path
        .and_then(|path| Path::new(path).parent())
        .filter(|directory| !directory.as_os_str().is_empty())
    {
        process.current_dir(directory);
    }

    let mut child = process
        .spawn()
        .map_err(|error| format!("Could not run filter command: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open filter command stdin".to_owned())?;
    let input = input.as_bytes().to_vec();
    let writer = thread::spawn(move || stdin.write_all(&input));
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not read filter command output: {error}"))?;

    writer
        .join()
        .map_err(|_| "Could not send text to filter command".to_owned())?
        .map_err(|error| format!("Could not send text to filter command: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if detail.is_empty() {
            format!("Filter command exited with {}", output.status)
        } else {
            detail
        });
    }

    String::from_utf8(output.stdout)
        .map_err(|error| format!("Filter command returned invalid UTF-8: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(path: &str) -> DocumentPayload {
        DocumentPayload {
            path: path.to_owned(),
            name: Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            contents: format!("# {path}"),
        }
    }

    #[test]
    fn document_assignments_are_scoped_to_their_windows() {
        let first = document("/tmp/first.md");
        let second = document("/tmp/second.md");
        let mut registry = DocumentWindowRegistry::default();

        registry.register_blank("main");
        registry.assign("main", first.clone());
        let second_label = registry.next_label();
        registry.register_blank(&second_label);
        registry.assign(&second_label, second.clone());

        assert_eq!(registry.document("main"), Some(&first));
        assert_eq!(registry.document(&second_label), Some(&second));
        assert_eq!(
            registry.window_for_path(Path::new("/tmp/first.md")),
            Some("main")
        );
        assert_eq!(
            registry.window_for_path(Path::new("/tmp/second.md")),
            Some(second_label.as_str())
        );
    }

    #[test]
    fn removing_a_window_releases_its_document_path() {
        let mut registry = DocumentWindowRegistry::default();
        registry.register_blank("main");
        registry.assign("main", document("/tmp/first.md"));

        registry.remove("main");

        assert_eq!(registry.window_for_path(Path::new("/tmp/first.md")), None);
        assert_eq!(registry.document("main"), None);
    }

    #[test]
    fn blank_windows_are_reused_before_new_windows_are_created() {
        let mut registry = DocumentWindowRegistry::default();

        assert_eq!(registry.blank_window(), Some("main"));

        registry.assign("main", document("/tmp/first.md"));

        assert_eq!(registry.blank_window(), None);
        assert_eq!(registry.next_label(), "document-1");
        assert_eq!(registry.next_label(), "document-2");
    }

    #[test]
    fn filter_commands_transform_stdin_to_stdout() {
        let output = run_filter_command("tr '[:lower:]' '[:upper:]'", "hello\n", None).unwrap();

        assert_eq!(output, "HELLO\n");
    }

    #[test]
    fn filter_command_failures_return_stderr() {
        let error =
            run_filter_command("echo formatter-failed >&2; exit 1", "input", None).unwrap_err();

        assert_eq!(error, "formatter-failed");
    }
}

#[tauri::command]
fn initial_document(
    window: WebviewWindow,
    documents: State<'_, DocumentWindows>,
) -> Result<Option<DocumentPayload>, String> {
    let document = documents
        .0
        .lock()
        .map_err(|_| "Could not access the document windows".to_owned())
        .map(|registry| registry.document(window.label()).cloned())?;

    if let Some(document) = &document {
        window
            .set_title(&document.name)
            .map_err(|error| format!("Could not update the window title: {error}"))?;
    }

    Ok(document)
}

#[tauri::command]
fn open_document(path: String, window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    open_document_path(&app, Path::new(&path), Some(window.label()))
}

#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|error| format!("Could not write {path}: {error}"))
}

#[tauri::command]
async fn filter_text(
    command: String,
    input: String,
    path: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_filter_command(&command, &input, path.as_deref())
    })
    .await
    .map_err(|error| format!("Could not complete filter command: {error}"))?
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
        .manage(DocumentWindows::default())
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
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .separator()
                .select_all()
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_editor)
                .build()?;
            let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .separator()
                .bring_all_to_front()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            for path in command_line_document_paths() {
                if let Err(error) = open_document_path(app.handle(), &path, Some("main")) {
                    eprintln!("{error}");
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            let focused_window = app
                .webview_windows()
                .into_values()
                .find(|window| window.is_focused().unwrap_or(false));

            if let Some(window) = focused_window {
                let _ = app.emit_to(window.label(), "menu-action", event.id().as_ref());
            }
        })
        .invoke_handler(tauri::generate_handler![
            initial_document,
            open_document,
            write_document,
            filter_text,
            print_document
        ])
        .build(tauri::generate_context!())
        .expect("error while building mdview");

    app.run(|app, event| match event {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        RunEvent::Opened { urls } => {
            for path in urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| path.is_file() && is_markdown(path))
            {
                if let Err(error) = open_document_path(app, &path, None) {
                    eprintln!("{error}");
                }
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } => {
            if let Ok(mut registry) = app.state::<DocumentWindows>().0.lock() {
                registry.remove(&label);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            if let Some(window) = app.webview_windows().into_values().next() {
                let _ = window.show().and_then(|_| window.set_focus());
            } else if let Err(error) = create_blank_window(app) {
                eprintln!("{error}");
            }
        }
        _ => {}
    });
}
