import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import mermaid from "mermaid";
import { forwardRef, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "./lib/markdown";

export interface RenderState {
  errors: number;
  pending: number;
}

interface MarkdownPreviewProps {
  documentPath: string | null;
  markdown: string;
  onRenderStateChange: (state: RenderState) => void;
}

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  flowchart: { curve: "basis", htmlLabels: true },
  sequence: { useMaxWidth: true },
  themeVariables: {
    background: "#ffffff",
    primaryColor: "#e9f5ee",
    primaryTextColor: "#15382b",
    primaryBorderColor: "#39815f",
    lineColor: "#567066",
    secondaryColor: "#fff0e8",
    tertiaryColor: "#f1f3f2",
    fontFamily: "IBM Plex Sans, sans-serif",
  },
});

type MermaidRenderResult = Awaited<ReturnType<typeof mermaid.render>>;
type MermaidBinding = NonNullable<MermaidRenderResult["bindFunctions"]>;
let diagramSequence = 0;
let renderQueue = Promise.resolve();

function renderMermaid(source: string): Promise<MermaidRenderResult> {
  const render = renderQueue.then(() =>
    mermaid.render(`mdview-diagram-${(diagramSequence += 1)}`, source),
  );
  renderQueue = render.then(
    () => undefined,
    () => undefined,
  );
  return render;
}

const MarkdownPreview = forwardRef<HTMLElement, MarkdownPreviewProps>(
  ({ documentPath, markdown: source, onRenderStateChange }, forwardedRef) => {
    const deferredSource = useDeferredValue(source);
    const renderedHtml = useMemo(
      () => renderMarkdown(deferredSource, (url) => resolveAssetUrl(url, documentPath)),
      [deferredSource, documentPath],
    );
    const [displayHtml, setDisplayHtml] = useState(renderedHtml);
    const containerRef = useRef<HTMLElement | null>(null);
    const bindingsRef = useRef<Array<{ bind: MermaidBinding; index: number }>>([]);
    const stateHandlerRef = useRef(onRenderStateChange);
    stateHandlerRef.current = onRenderStateChange;

    function setContainer(element: HTMLElement | null) {
      containerRef.current = element;

      if (typeof forwardedRef === "function") {
        forwardedRef(element);
      } else if (forwardedRef) {
        forwardedRef.current = element;
      }
    }

    useEffect(() => {
      const template = document.createElement("template");
      template.innerHTML = renderedHtml;
      const diagrams = Array.from(
        template.content.querySelectorAll<HTMLElement>("[data-mermaid-source]"),
      );
      let cancelled = false;
      let errors = 0;

      bindingsRef.current = [];
      setDisplayHtml(renderedHtml);
      stateHandlerRef.current({ errors, pending: diagrams.length });

      async function renderDiagrams() {
        const bindings: Array<{ bind: MermaidBinding; index: number }> = [];

        for (const [index, diagram] of diagrams.entries()) {
          try {
            const source = decodeURIComponent(diagram.dataset.mermaidSource ?? "");
            const { bindFunctions, svg } = await renderMermaid(source);

            if (cancelled) return;
            diagram.innerHTML = svg;
            diagram.removeAttribute("data-mermaid-source");
            if (bindFunctions) bindings.push({ bind: bindFunctions, index });
          } catch (error) {
            if (cancelled) return;
            errors += 1;
            diagram.classList.add("mermaid-error");
            diagram.replaceChildren();

            const heading = document.createElement("strong");
            heading.textContent = "Diagram could not be rendered";
            const detail = document.createElement("pre");
            detail.textContent = error instanceof Error ? error.message : String(error);
            diagram.append(heading, detail);
          }
        }

        if (cancelled) return;
        bindingsRef.current = bindings;
        setDisplayHtml(template.innerHTML);
        stateHandlerRef.current({ errors, pending: 0 });
      }

      void renderDiagrams();

      return () => {
        cancelled = true;
      };
    }, [renderedHtml]);

    useEffect(() => {
      const diagrams = containerRef.current?.querySelectorAll<HTMLElement>(".mermaid-figure");
      if (!diagrams) return;

      bindingsRef.current.forEach(({ bind, index }) => {
        const diagram = diagrams.item(index);
        if (diagram) bind(diagram);
      });
      bindingsRef.current = [];
    }, [displayHtml]);

    return (
      <article
        className="markdown-body"
        data-testid="markdown-preview"
        dangerouslySetInnerHTML={{ __html: displayHtml }}
        ref={setContainer}
      />
    );
  },
);

MarkdownPreview.displayName = "MarkdownPreview";

export default MarkdownPreview;

function resolveAssetUrl(url: string, documentPath: string | null): string {
  if (!documentPath || !isTauri() || /^(?:[a-z]+:|#|\/)/i.test(url)) return url;

  const separator = documentPath.includes("\\") ? "\\" : "/";
  const directory = documentPath.slice(0, documentPath.lastIndexOf(separator));
  let relativePath = url;

  try {
    relativePath = decodeURIComponent(url);
  } catch {}

  return convertFileSrc(`${directory}${separator}${relativePath}`);
}
