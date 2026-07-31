import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { vim } from "@replit/codemirror-vim";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath as openSystemPath, openUrl } from "@tauri-apps/plugin-opener";
import CodeMirror from "@uiw/react-codemirror";
import {
  Code2,
  Download,
  Eye,
  FileDown,
  FileText,
  FolderOpen,
  LoaderCircle,
  Printer,
  Save,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, MouseEvent, ReactNode, useEffect, useRef, useState } from "react";
import "./App.css";
import MarkdownPreview, { RenderState } from "./MarkdownPreview";
import { isMarkdownPath, resolveLocalPath } from "./lib/links";
import { createStandaloneHtml } from "./lib/markdown";
import { registerVimFilterOperator, registerVimWriteCommand } from "./lib/vim";
import "./markdown.css";

interface OpenDocument {
  contents: string;
  name: string;
  path: string | null;
}

const markdownFilters = [
  { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx"] },
];
const editorExtensions = [vim(), markdownLanguage()];

function App() {
  const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);
  const [source, setSource] = useState("");
  const [savedSource, setSavedSource] = useState("");
  const [editorVisible, setEditorVisible] = useState(false);
  const [isBusy, setIsBusy] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<RenderState>({ errors: 0, pending: 0 });
  const previewRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterTextRef = useRef<(command: string, input: string) => Promise<string>>(() =>
    Promise.reject(new Error("Shell filters are available in the desktop app.")),
  );
  const menuActionRef = useRef<(action: string) => void>(() => undefined);
  const openPathRef = useRef<(path: string) => void>(() => undefined);
  const dirtyRef = useRef(false);
  const dirty = openDocument !== null && source !== savedSource;
  dirtyRef.current = dirty;

  async function openPath(path: string) {
    setNotice(null);

    try {
      await invoke("open_document", { path });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDragging(false);
    }
  }

  function loadBrowserFile(file: File) {
    if (dirty && !window.confirm("Discard the unsaved changes in this document?")) return;

    setIsBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      const contents = String(reader.result ?? "");
      setOpenDocument({ contents, name: file.name, path: null });
      setSource(contents);
      setSavedSource(contents);
      setEditorVisible(false);
      setIsBusy(false);
      setIsDragging(false);
    };
    reader.onerror = () => {
      setNotice(`Could not read ${file.name}.`);
      setIsBusy(false);
      setIsDragging(false);
    };
    reader.readAsText(file);
  }

  async function requestOpen() {
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }

    const path = await openDialog({
      title: "Open Markdown",
      filters: markdownFilters,
      multiple: false,
      directory: false,
      fileAccessMode: "scoped",
    });

    if (typeof path === "string") await openPath(path);
  }

  async function saveMarkdown() {
    if (!openDocument) return;

    try {
      if (isTauri() && openDocument.path) {
        await invoke("write_document", { path: openDocument.path, contents: source });
      } else {
        downloadText(openDocument.name, source, "text/markdown;charset=utf-8");
      }

      setSavedSource(source);
      setNotice("Document saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function waitForDiagrams(): Promise<boolean> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (!previewRef.current?.querySelector("[data-mermaid-source], .mermaid-pending")) {
        return true;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }

    setNotice("The diagrams are still rendering. Try exporting again in a moment.");
    return false;
  }

  function exportedMarkup(): string | null {
    if (!previewRef.current) return null;

    const copy = previewRef.current.cloneNode(true) as HTMLElement;
    copy.querySelectorAll<HTMLImageElement>("img[data-original-src]").forEach((image) => {
      image.src = image.dataset.originalSrc ?? image.src;
      image.removeAttribute("data-original-src");
    });
    return copy.innerHTML;
  }

  async function exportHtml() {
    if (!openDocument || !(await waitForDiagrams())) return;

    const renderedBody = exportedMarkup();
    if (!renderedBody) return;

    const exportName = replaceExtension(openDocument.name, "html");
    const html = createStandaloneHtml(openDocument.name, renderedBody);

    try {
      if (isTauri()) {
        const path = await saveDialog({
          title: "Export rendered HTML",
          defaultPath: openDocument.path
            ? replaceExtension(openDocument.path, "html")
            : exportName,
          filters: [{ name: "HTML", extensions: ["html"] }],
        });

        if (!path) return;
        await invoke("write_document", { path, contents: html });
      } else {
        downloadText(exportName, html, "text/html;charset=utf-8");
      }

      setNotice("Rendered HTML exported with inline SVG diagrams.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportPdf() {
    if (!openDocument || !(await waitForDiagrams())) return;

    try {
      if (isTauri()) {
        await invoke("print_document");
      } else {
        window.print();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function handleMenuAction(action: string) {
    switch (action) {
      case "open":
        void requestOpen();
        break;
      case "save":
        void saveMarkdown();
        break;
      case "export-html":
        void exportHtml();
        break;
      case "export-pdf":
        void exportPdf();
        break;
      case "toggle-editor":
        if (openDocument) setEditorVisible((visible) => !visible);
        break;
    }
  }

  menuActionRef.current = handleMenuAction;
  openPathRef.current = openPath;
  filterTextRef.current = (command, input) => {
    if (!isTauri()) {
      return Promise.reject(new Error("Shell filters are available in the desktop app."));
    }

    return invoke<string>("filter_text", { command, input, path: openDocument?.path });
  };

  useEffect(() => {
    registerVimWriteCommand(() => menuActionRef.current("save"));
    registerVimFilterOperator(
      (command, input) => filterTextRef.current(command, input),
      setNotice,
    );
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setIsBusy(false);
      return;
    }

    let disposed = false;
    const cleanups: Array<() => void> = [];

    async function initializeDesktop() {
      const unlistenOpen = await listen<OpenDocument>("open-document", ({ payload }) => {
        setOpenDocument(payload);
        setSource(payload.contents);
        setSavedSource(payload.contents);
        setEditorVisible(false);
        setIsBusy(false);
      });
      const unlistenMenu = await listen<string>("menu-action", ({ payload }) => {
        menuActionRef.current(payload);
      });
      const unlistenClose = await getCurrentWindow().onCloseRequested((event) => {
        if (
          dirtyRef.current &&
          !window.confirm("Close this window and discard its unsaved changes?")
        ) {
          event.preventDefault();
        }
      });
      const unlistenDrop = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragging(true);
        } else if (event.payload.type === "leave") {
          setIsDragging(false);
        } else if (event.payload.type === "drop") {
          const [path] = event.payload.paths;
          if (path) openPathRef.current(path);
          else setIsDragging(false);
        }
      });

      if (disposed) {
        unlistenOpen();
        unlistenMenu();
        unlistenClose();
        unlistenDrop();
        return;
      }
      cleanups.push(unlistenOpen, unlistenMenu, unlistenClose, unlistenDrop);

      try {
        const initialDocument = await invoke<OpenDocument | null>("initial_document");
        if (!disposed && initialDocument) {
          setOpenDocument(initialDocument);
          setSource(initialDocument.contents);
          setSavedSource(initialDocument.contents);
        }
      } catch (error) {
        if (!disposed) setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        if (!disposed) setIsBusy(false);
      }
    }

    void initializeDesktop();

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (isTauri() || !(event.metaKey || event.ctrlKey)) return;

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        menuActionRef.current("save");
      } else if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        menuActionRef.current("toggle-editor");
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        menuActionRef.current("open");
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  function handleBrowserFile(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.currentTarget.files ?? []);
    if (file) loadBrowserFile(file);
    event.currentTarget.value = "";
  }

  function handleBrowserDrop(event: DragEvent) {
    event.preventDefault();
    const [file] = Array.from(event.dataTransfer.files);
    if (file) loadBrowserFile(file);
    else setIsDragging(false);
  }

  function handlePreviewClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    if (/^(https?:|mailto:)/i.test(href) && isTauri()) {
      event.preventDefault();
      void openUrl(href);
      return;
    }

    if (!isTauri()) return;

    const localPath = resolveLocalPath(href, openDocument?.path ?? null);
    if (!localPath) return;

    event.preventDefault();
    if (isMarkdownPath(localPath)) {
      void openPath(localPath);
    } else {
      void openSystemPath(localPath).catch((error) => {
        setNotice(error instanceof Error ? error.message : String(error));
      });
    }
  }

  const lineCount = source ? source.split("\n").length : 0;
  const wordCount = source.trim() ? source.trim().split(/\s+/).length : 0;

  return (
    <div
      className={`app-shell ${isDragging ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={handleBrowserDrop}
    >
      <header className="toolbar">
        <div className="toolbar-identity">
          <span className="app-mark" aria-hidden="true">
            <FileText size={17} strokeWidth={2.1} />
          </span>
          <strong>mdview</strong>
          {openDocument && (
            <>
              <span className="toolbar-divider" />
              <span className="document-name" title={openDocument.path ?? openDocument.name}>
                {openDocument.name}
              </span>
              {dirty && <span className="dirty-indicator" aria-label="Unsaved changes" />}
            </>
          )}
        </div>

        <nav className="toolbar-actions" aria-label="Document actions">
          <IconButton label="Open Markdown" onClick={() => void requestOpen()}>
            <FolderOpen size={17} />
          </IconButton>
          {openDocument && (
            <>
              <IconButton disabled={!dirty} label="Save Markdown" onClick={() => void saveMarkdown()}>
                <Save size={17} />
              </IconButton>
              <span className="toolbar-divider" />
              <IconButton label="Export rendered HTML" onClick={() => void exportHtml()}>
                <FileDown size={17} />
              </IconButton>
              <IconButton label="Export PDF" onClick={() => void exportPdf()}>
                <Printer size={17} />
              </IconButton>
              <span className="toolbar-divider" />
              <IconButton
                active={editorVisible}
                label={editorVisible ? "Hide editor" : "Show editor"}
                onClick={() => setEditorVisible((visible) => !visible)}
              >
                {editorVisible ? <Eye size={17} /> : <Code2 size={17} />}
              </IconButton>
            </>
          )}
        </nav>
      </header>

      {isBusy ? (
        <main className="loading-state">
          <LoaderCircle className="spinner" size={24} />
          <span>Opening document</span>
        </main>
      ) : openDocument ? (
        <main className={`workspace ${editorVisible ? "has-editor" : ""}`}>
          {editorVisible && (
            <section className="editor-pane" aria-label="Markdown editor">
              <header className="panel-header">
                <span>Markdown</span>
                <span className="vim-badge">VIM</span>
              </header>
              <CodeMirror
                aria-label="Markdown source"
                basicSetup={{
                  bracketMatching: true,
                  closeBrackets: true,
                  foldGutter: false,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: true,
                  lineNumbers: true,
                }}
                className="source-editor"
                extensions={editorExtensions}
                height="100%"
                onChange={setSource}
                value={source}
              />
            </section>
          )}

          <section className="preview-pane" aria-label="Rendered preview" onClick={handlePreviewClick}>
            <div className="preview-scroll">
              <MarkdownPreview
                documentPath={openDocument.path}
                markdown={source}
                onRenderStateChange={setRenderState}
                ref={previewRef}
              />
            </div>
          </section>
        </main>
      ) : (
        <main className="welcome">
          <div className="welcome-icon" aria-hidden="true">
            <FileText size={46} strokeWidth={1.35} />
          </div>
          <h1>mdview</h1>
          <p>Drop a Markdown file here</p>
          <button className="primary-action" onClick={() => void requestOpen()} type="button">
            <FolderOpen size={17} />
            Open Markdown
          </button>
          <span className="welcome-formats">.md · .markdown · .mdown · .mkd · .mdx</span>
        </main>
      )}

      <footer className="statusbar">
        <span className="status-path">
          {openDocument?.path ?? (openDocument ? "Browser preview" : "Ready")}
        </span>
        {openDocument && (
          <span className="status-metrics">
            {renderState.pending > 0 && `${renderState.pending} rendering · `}
            {renderState.errors > 0 && `${renderState.errors} diagram error · `}
            {lineCount} lines · {wordCount} words
          </span>
        )}
      </footer>

      {isDragging && (
        <div className="drop-overlay" aria-live="polite">
          <Download size={34} />
          <strong>Drop to open</strong>
        </div>
      )}

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice(null)} title="Dismiss" type="button">
            <X size={15} />
          </button>
        </div>
      )}

      <input
        accept=".md,.markdown,.mdown,.mkd,.mdx,text/markdown"
        className="visually-hidden"
        onChange={handleBrowserFile}
        ref={fileInputRef}
        type="file"
      />
    </div>
  );
}

interface IconButtonProps {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

function IconButton({ active = false, children, disabled = false, label, onClick }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={active || undefined}
      className={`icon-button ${active ? "is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function replaceExtension(path: string, extension: string): string {
  return path.replace(/(\.[^./\\]+)?$/, `.${extension}`);
}

function downloadText(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default App;
