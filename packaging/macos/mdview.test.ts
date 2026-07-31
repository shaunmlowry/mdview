import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const buildScript = readFileSync(
  join(process.cwd(), "scripts/build-macos-pkg.sh"),
  "utf8",
);

describe("macOS command-line launcher", () => {
  it("routes every invocation to the app's document-window manager", () => {
    const launcher = readFileSync(join(process.cwd(), "packaging/macos/mdview"), "utf8");

    expect(launcher).toContain('exec /usr/bin/open -a "$app_path" "$@"');
    expect(launcher).not.toContain("/usr/bin/open -n");
  });

  it("stages a metadata-free, fully signed app bundle", () => {
    expect(buildScript).toContain('/usr/bin/ditto --norsrc --noextattr "$app_path"');
    expect(buildScript).toContain(
      '/usr/bin/codesign --force --deep --sign - "$staging_dir/Applications/mdview.app"',
    );
  });
});
