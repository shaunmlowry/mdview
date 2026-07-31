const markdownExtension = /\.(?:md|markdown|mdown|mkd|mdx)$/i;

export function resolveLocalPath(href: string, documentPath: string | null): string | null {
  if (!documentPath || href.startsWith("#") || href.startsWith("//")) return null;

  const windowsPath = /^[a-z]:[\\/]/i.test(documentPath);
  const baseUrl = new URL("file:///");
  baseUrl.pathname = documentPath.replace(/\\/g, "/");

  try {
    const resolvedUrl = new URL(href, baseUrl);
    if (resolvedUrl.protocol !== "file:" || resolvedUrl.hostname) return null;

    const resolvedPath = decodeURIComponent(resolvedUrl.pathname);
    return windowsPath ? resolvedPath.replace(/^\//, "").replace(/\//g, "\\") : resolvedPath;
  } catch {
    return null;
  }
}

export function isMarkdownPath(path: string): boolean {
  return markdownExtension.test(path);
}