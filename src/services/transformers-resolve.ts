/**
 * Resolve the CJS entry of `@huggingface/transformers` for OpenCode hosts (#463).
 *
 * OpenCode nested installs (Bun linker / npm cache layouts) sometimes make
 * Node's createRequire(packageName) fail even when the package exists on disk.
 * Walk node_modules and prefer Bun.resolveSync, then load the package's
 * `exports.node.require` entry so the onnxruntime pin shim still applies.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TRANSFORMERS_PACKAGE = ["@huggingface", "transformers"].join("/");

/** Non-literal specifier so plugin bundlers do not eagerly traverse transformers. */
export function getTransformersPackageSpecifier(): string {
  return TRANSFORMERS_PACKAGE;
}

type PackageJsonExports = {
  node?: {
    require?: { default?: string } | string;
    import?: { default?: string } | string;
  };
  require?: { default?: string } | string;
  default?: { default?: string } | string;
};

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asExportPath(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { default?: unknown }).default === "string"
  ) {
    return (value as { default: string }).default;
  }
  return null;
}

/** Pick the Node CJS entry from a transformers package.json. */
export function cjsEntryFromPackageJson(pkgJsonPath: string): string {
  const pkg = readJson(pkgJsonPath);
  if (!pkg) throw new Error(`Unable to read ${pkgJsonPath}`);
  const exportsField = pkg.exports as PackageJsonExports | undefined;
  const relative =
    asExportPath(exportsField?.node?.require) ||
    asExportPath(exportsField?.require) ||
    (typeof pkg.main === "string" ? pkg.main : null) ||
    "./dist/transformers.node.cjs";
  return join(dirname(pkgJsonPath), relative);
}

function packageJsonCandidates(startDir: string, packageName: string): string[] {
  const parts = packageName.split("/");
  const out: string[] = [];
  let dir = startDir;
  for (let i = 0; i < 16; i++) {
    out.push(join(dir, "node_modules", ...parts, "package.json"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

function normalizeStartPath(value: string): string {
  if (value.startsWith("file:")) {
    try {
      return fileURLToPath(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Resolve Bun's install layout when Node createRequire cannot see the package.
 */
export function resolveWithBun(specifier: string, fromPath: string): string | null {
  const bun = (globalThis as { Bun?: { resolveSync?: (id: string, root: string) => string } }).Bun;
  if (typeof bun?.resolveSync !== "function") return null;
  try {
    const fromDir = fromPath.endsWith(sep) ? fromPath : dirname(fromPath);
    return bun.resolveSync(specifier, fromDir);
  } catch {
    return null;
  }
}

export function resolveTransformersCjsEntry(options: {
  requireFn: NodeRequire;
  startPaths?: Array<string | undefined | null>;
  specifier?: string;
}): string {
  const specifier = options.specifier ?? TRANSFORMERS_PACKAGE;
  const errors: string[] = [];

  try {
    return options.requireFn.resolve(specifier);
  } catch (error) {
    errors.push(`require.resolve: ${error instanceof Error ? error.message : String(error)}`);
  }

  const starts = (options.startPaths ?? [])
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map(normalizeStartPath);

  for (const start of starts) {
    const bunResolved = resolveWithBun(specifier, start);
    if (bunResolved) {
      // Bun may return the ESM entry; normalize to CJS via package.json.
      let dir = dirname(bunResolved);
      for (let i = 0; i < 6; i++) {
        const pkgJson = join(dir, "package.json");
        if (existsSync(pkgJson)) {
          const pkg = readJson(pkgJson);
          if (pkg?.name === specifier) return cjsEntryFromPackageJson(pkgJson);
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      if (bunResolved.endsWith(".cjs") || bunResolved.endsWith(".js")) return bunResolved;
      errors.push(`Bun.resolveSync returned non-CJS entry: ${bunResolved}`);
    }

    for (const candidate of packageJsonCandidates(dirname(start), specifier)) {
      if (!existsSync(candidate)) continue;
      try {
        return cjsEntryFromPackageJson(candidate);
      } catch (error) {
        errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  throw new Error(
    [
      `Cannot resolve ${specifier} before installing the onnxruntime pin shim (#463).`,
      "The package should be installed next to opencode-mem; OpenCode nested installs sometimes hide it from Node createRequire.",
      "Fix: clear the OpenCode plugin cache (e.g. ~/.cache/opencode/npm/opencode-mem@* and ~/.cache/opencode/packages/opencode-mem@*) and reinstall, or set embeddingApiUrl + embeddingApiKey for remote embeddings.",
      errors.length > 0 ? `Attempts: ${errors.join(" | ")}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    { cause: errors[0] }
  );
}

/** Test helper: expose path→fileURL conversion for Bun resolve roots. */
export function toFileUrlIfNeeded(path: string): string {
  return path.startsWith("file:") ? path : pathToFileURL(path).href;
}
