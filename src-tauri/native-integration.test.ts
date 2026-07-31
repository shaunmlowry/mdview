import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tauriSource = readFileSync(
  join(process.cwd(), "src-tauri/src/lib.rs"),
  "utf8",
);
const capabilities = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/capabilities/default.json"),
    "utf8",
  ),
) as { permissions: string[]; windows: string[] };

describe("native document-window integration", () => {
  it("provides standard native clipboard commands", () => {
    expect(tauriSource).toMatch(
      /SubmenuBuilder::new\(app, "Edit"\)[\s\S]*?\.cut\(\)[\s\S]*?\.copy\(\)[\s\S]*?\.paste\(\)/,
    );
  });

  it("routes custom menu actions to the focused window", () => {
    expect(tauriSource).toContain(
      'app.emit_to(window.label(), "menu-action", event.id().as_ref())',
    );
  });

  it("grants document windows the APIs needed for independent lifecycle handling", () => {
    expect(capabilities.windows).toEqual(["main", "document-*"]);
    expect(capabilities.permissions).toContain("core:window:allow-destroy");
    expect(capabilities.permissions).toContain("opener:allow-open-path");
  });
});
