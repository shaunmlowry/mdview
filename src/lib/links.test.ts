import { describe, expect, it } from "vitest";
import { isMarkdownPath, resolveLocalPath } from "./links";

describe("local Markdown links", () => {
  const documentPath = "/workspace/tasks/explore-identity/identity-proposals-no-okta-ai.md";

  it("resolves relative file links from the open document", () => {
    expect(resolveLocalPath("../untitled/keycard-proof-report.md", documentPath)).toBe(
      "/workspace/tasks/untitled/keycard-proof-report.md",
    );
    expect(resolveLocalPath("notes/Proof%20report.md#results", documentPath)).toBe(
      "/workspace/tasks/explore-identity/notes/Proof report.md",
    );
    expect(resolveLocalPath("../shared.md", "C:\\workspace\\docs\\current.md")).toBe(
      "C:\\workspace\\shared.md",
    );
  });

  it("leaves web and same-document links to their existing handlers", () => {
    expect(resolveLocalPath("https://docs.keycard.ai/admin/catalog/", documentPath)).toBeNull();
    expect(resolveLocalPath("#provider-coverage", documentPath)).toBeNull();
  });

  it("recognizes the Markdown extensions supported by mdview", () => {
    expect(isMarkdownPath("/tmp/proposal.MD")).toBe(true);
    expect(isMarkdownPath("/tmp/awsOutboundFederationCredential.ts")).toBe(false);
  });
});