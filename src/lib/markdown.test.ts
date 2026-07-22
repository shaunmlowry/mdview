import { describe, expect, it } from "vitest";
import { createStandaloneHtml, renderMarkdown } from "./markdown";

describe("markdown rendering", () => {
  it("renders rich markdown and preserves Mermaid source for SVG rendering", () => {
    const result = renderMarkdown(`# Example

- [x] Complete

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\``);

    expect(result).toMatch(/<h1 id="example"[^>]*>Example<\/h1>/);
    expect(result).toContain("task-list-item");
    expect(result).toContain('data-mermaid-source="flowchart%20LR');
  });

  it("removes executable markup", () => {
    const result = renderMarkdown('<img src="x" onerror="alert(1)"><script>alert(1)</script>');

    expect(result).not.toContain("onerror");
    expect(result).not.toContain("<script");
  });

  it("exports a complete document with already-rendered SVG", () => {
    const result = createStandaloneHtml("Plan & notes", '<svg aria-label="diagram"></svg>');

    expect(result).toContain("<!doctype html>");
    expect(result).toContain("<title>Plan &amp; notes</title>");
    expect(result).toContain('<svg aria-label="diagram"></svg>');
    expect(result).not.toContain("mermaid.min.js");
  });
});
