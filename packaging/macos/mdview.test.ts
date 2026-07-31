import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("macOS command-line launcher", () => {
  it("routes every invocation to the app's document-window manager", () => {
    const launcher = readFileSync(join(process.cwd(), "packaging/macos/mdview"), "utf8");

    expect(launcher).toContain('exec /usr/bin/open -a "$app_path" "$@"');
    expect(launcher).not.toContain("/usr/bin/open -n");
  });
});
