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

  it("renders named footnotes and backlinks", () => {
    const result = renderMarkdown(`First claim[^policy] and second claim[^policy].

[^policy]: Policy details with a [source](https://example.com).`);

    expect(result).toContain('class="footnote-ref"');
    expect(result).toContain('href="#fn1"');
    expect(result).toContain('id="fn1"');
    expect(result).toContain('class="footnote-backref"');
    expect(result).toContain('href="https://example.com"');
    expect(result).not.toContain("[^policy]");
  });

  it("exports a complete document with already-rendered SVG", () => {
    const result = createStandaloneHtml("Plan & notes", '<svg aria-label="diagram"></svg>');

    expect(result).toContain("<!doctype html>");
    expect(result).toContain("<title>Plan &amp; notes</title>");
    expect(result).toContain('<svg aria-label="diagram"></svg>');
    expect(result).not.toContain("mermaid.min.js");
  });
});
