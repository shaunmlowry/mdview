import DOMPurify from "dompurify";
import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import markdownStyles from "../markdown.css?inline";

const markdown: MarkdownIt = new MarkdownIt({
  breaks: false,
  html: true,
  linkify: true,
  typographer: true,
  highlight(source: string, language: string): string {
    if (language && hljs.getLanguage(language)) {
      return `<pre class="hljs"><code>${hljs.highlight(source, {
        language,
        ignoreIllegals: true,
      }).value}</code></pre>`;
    }

    return `<pre class="hljs"><code>${markdown.utils.escapeHtml(source)}</code></pre>`;
  },
})
  .use(anchor, {
    slugify: (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-"),
  })
  .use(taskLists, { enabled: true, label: true, labelAfter: true });

const defaultFence = markdown.renderer.rules.fence;
const defaultImage = markdown.renderer.rules.image;
const renderFence: NonNullable<typeof markdown.renderer.rules.fence> = (
  tokens,
  index,
  options,
  environment,
  renderer,
) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0].toLowerCase();

  if (language === "mermaid") {
    return `<figure class="mermaid-figure" data-mermaid-source="${encodeURIComponent(
      token.content,
    )}"><div class="mermaid-pending" role="status">Rendering diagram...</div></figure>`;
  }

  return defaultFence?.(tokens, index, options, environment, renderer) ?? "";
};

markdown.renderer.rules.fence = renderFence;

markdown.renderer.rules.image = (tokens, index, options, environment, renderer) => {
  const source = tokens[index].attrGet("src");
  const transformUrl = environment.transformUrl as ((url: string) => string) | undefined;

  if (source && transformUrl) {
    tokens[index].attrSet("data-original-src", source);
    tokens[index].attrSet("src", transformUrl(source));
  }

  return defaultImage?.(tokens, index, options, environment, renderer) ?? "";
};

export function renderMarkdown(source: string, transformUrl?: (url: string) => string): string {
  return DOMPurify.sanitize(markdown.render(source, { transformUrl }), {
    ADD_ATTR: ["checked", "data-mermaid-source", "disabled", "target"],
    ADD_TAGS: ["details", "summary"],
    ALLOW_DATA_ATTR: true,
  });
}

export function createStandaloneHtml(title: string, renderedBody: string): string {
  const safeTitle = markdown.utils.escapeHtml(title);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>${markdownStyles}</style>
  </head>
  <body class="exported-document">
    <main class="markdown-body">${renderedBody}</main>
  </body>
</html>
`;
}
