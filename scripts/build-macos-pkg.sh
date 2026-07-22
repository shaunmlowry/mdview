#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(cd "$root_dir" && node -p "require('./package.json').version")
architecture=$(uname -m)
app_path="$root_dir/src-tauri/target/release/bundle/macos/mdview.app"
output_dir="$root_dir/src-tauri/target/release/bundle/pkg"
output_path="$output_dir/mdview_${version}_${architecture}.pkg"
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/mdview-pkg.XXXXXX")

cleanup() {
  rm -rf "$staging_dir"
}
trap cleanup EXIT INT TERM

if [ ! -d "$app_path" ]; then
  echo "mdview.app was not found. Run 'npm run tauri build' first." >&2
  exit 1
fi

mkdir -p "$staging_dir/Applications" "$staging_dir/usr/local/bin" "$output_dir"
/usr/bin/ditto "$app_path" "$staging_dir/Applications/mdview.app"
/usr/bin/install -m 755 "$root_dir/packaging/macos/mdview" "$staging_dir/usr/local/bin/mdview"

rm -f "$output_path"
/usr/bin/pkgbuild \
  --root "$staging_dir" \
  --identifier app.mdview.desktop.pkg \
  --version "$version" \
  --install-location / \
  --ownership recommended \
  "$output_path"

echo "Built $output_path"