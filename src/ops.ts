import type { PageSpaceApi, PageType } from "./api.ts";
import type { PageSpaceResolver } from "./resolve.ts";

// --- pi tool-operation shapes (mirrored locally so this module is dependency-free) ---
export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}
export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}
export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}
export interface LsOperations {
  exists: (absolutePath: string) => Promise<boolean>;
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }>;
  readdir: (absolutePath: string) => Promise<string[]>;
}
export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean>;
  glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]>;
}
export interface GrepOperations {
  isDirectory: (absolutePath: string) => Promise<boolean>;
  readFile: (absolutePath: string) => Promise<string>;
}

export interface PageSpaceOpsConfig {
  /** Absolute path prefix that maps into PageSpace, e.g. `<cwd>/pagespace`. */
  mountRoot: string;
  /** contentMode for created `.md`/text pages. */
  defaultContentMode?: "markdown" | "html";
  /** Drive slug used by `grepSearch` when the search path is the bare mount root (no drive). */
  defaultDriveSlug?: string;
}

/** pi's grep tool params (the subset we honor). */
export interface GrepParams {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  limit?: number;
}
/** pi tool-result shape (text content). `details` is always present (may be undefined). */
export interface GrepResult {
  content: { type: "text"; text: string }[];
  details: { matchLimitReached?: number } | undefined;
}

export interface PageSpaceOps {
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
  ls: LsOperations;
  find: FindOperations;
  grep: GrepOperations;
  /**
   * Server-side grep for mount paths. pi's built-in grep spawns ripgrep against the LOCAL
   * filesystem (its `GrepOperations` only feed context lines), so it cannot search PageSpace
   * pages — this routes the search to the drive's `regex_search` endpoint instead and formats
   * the results in pi's `path:line: content` grep style.
   */
  grepSearch: (params: GrepParams) => Promise<GrepResult>;
  /** True when an absolute path falls under the PageSpace mount. */
  isMountPath: (absolutePath: string) => boolean;
}

// The drive's regex_search runs Postgres `~` (case-sensitive) and DOUBLES any lone backslash,
// so client-side `\`-escaping breaks (e.g. `\(` -> `\\(` -> unbalanced group -> 500) and `(?i)`
// is ignored. We therefore build backslash-free patterns: bracket-class escaping for literals and
// a syntax-aware letter->[aA] transform for case-insensitivity.

/** Escape a literal string into a backslash-free regex (Postgres-safe). */
export function literalToPgRegex(s: string, ignoreCase: boolean): string {
  let out = "";
  for (const ch of s) {
    if (ignoreCase && /[a-z]/i.test(ch)) {
      out += `[${ch.toLowerCase()}${ch.toUpperCase()}]`;
    } else if (/[a-zA-Z0-9_\s]/.test(ch)) {
      out += ch; // safe literal char
    } else if (ch === "]") {
      out += "[]]"; // a `]` right after `[` is a literal member in Postgres bracket expressions
    } else if (ch === "-") {
      out += "[-]";
    } else if (ch === "^") {
      out += "[\\^]"; // rare in literal grep; over-matches a stray backslash but matches `^`
    } else {
      out += `[${ch}]`; // bracket-escape ( ) . * + ? { } | $ [ etc. — no backslash needed
    }
  }
  return out;
}

// The server only returns per-line previews (`matchingLines`) for PLAIN-LITERAL patterns (a
// security guard against running user regex on content). For anything else it returns the matched
// PAGES only — so we use it as a prefilter and extract lines client-side with a JS regex.
const REGEX_META = /[.*+?^${}()|[\]\\]/;
const hasRegexMeta = (s: string): boolean => REGEX_META.test(s);
const jsEscapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build the JS regex used for client-side line extraction (returns null if the regex is invalid). */
function buildClientRegex(params: GrepParams): RegExp | null {
  const flags = params.ignoreCase ? "i" : "";
  const src = params.literal ? jsEscapeRegex(params.pattern) : params.pattern;
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

/** Extract matching lines from a page's content (1-based line numbers, like grep/ripgrep). */
export function matchLinesIn(content: string, re: RegExp): { lineNumber: number; content: string }[] {
  const out: { lineNumber: number; content: string }[] = [];
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    if (re.test(lines[i])) out.push({ lineNumber: i + 1, content: lines[i] });
  }
  return out;
}

/** Make a regex case-insensitive without flags: rewrite letters as `[aA]`, respecting escapes/classes. */
export function regexToCaseInsensitive(s: string): string {
  let out = "";
  let escaped = false;
  let inClass = false;
  for (const ch of s) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    } // keep \d, \w, … intact
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      out += ch;
      continue;
    }
    if (ch === "]") {
      inClass = false;
      out += ch;
      continue;
    }
    if (/[a-z]/i.test(ch)) {
      const both = `${ch.toLowerCase()}${ch.toUpperCase()}`;
      out += inClass ? both : `[${both}]`;
    } else {
      out += ch;
    }
  }
  return out;
}

function norm(p: string): string {
  return p.replace(/\/+/g, "/").replace(/\/$/, "");
}

export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\^$+.()|{}[]".includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function createPageSpaceOps(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  config: PageSpaceOpsConfig,
): PageSpaceOps {
  const mountRoot = norm(config.mountRoot);
  const contentMode = config.defaultContentMode ?? "markdown";

  const isMountPath = (absolutePath: string): boolean => {
    const p = norm(absolutePath);
    return p === mountRoot || p.startsWith(`${mountRoot}/`);
  };
  const toMountRel = (absolutePath: string): string => {
    const p = norm(absolutePath);
    if (!isMountPath(p)) throw new Error(`Path is not under the PageSpace mount: ${absolutePath}`);
    return p === mountRoot ? "" : p.slice(mountRoot.length + 1);
  };

  const readFileStr = async (absolutePath: string): Promise<string> => {
    const r = await resolver.resolve(toMountRel(absolutePath));
    if (!r.page) throw new Error(`ENOENT: no such PageSpace page: ${absolutePath}`);
    if (r.page.type === "FOLDER") throw new Error(`EISDIR: is a folder: ${absolutePath}`);
    return api.readContent(r.page.id);
  };

  const writeStr = async (absolutePath: string, content: string): Promise<void> => {
    const rel = toMountRel(absolutePath);
    const r = await resolver.resolve(rel);
    if (r.page) {
      await api.patchPage(r.page.id, { content });
    } else {
      const md = /\.(md|markdown|txt)$/i.test(r.title) || contentMode === "markdown";
      await api.createPage({
        driveId: r.driveId,
        title: r.title,
        type: "DOCUMENT",
        parentId: r.parentId,
        content,
        contentMode: md ? "markdown" : "html",
      });
      resolver.invalidate(r.driveId);
    }
  };

  const access = async (absolutePath: string): Promise<void> => {
    const r = await resolver.resolve(toMountRel(absolutePath));
    if (!r.page && toMountRel(absolutePath) !== "") {
      throw new Error(`ENOENT: ${absolutePath}`);
    }
  };

  const exists = async (absolutePath: string): Promise<boolean> => {
    try {
      const rel = toMountRel(absolutePath);
      if (rel === "") return true; // drive root
      const r = await resolver.resolve(rel);
      return r.page !== null;
    } catch {
      return false;
    }
  };

  const containerId = async (absolutePath: string): Promise<{ driveId: string; parentId: string | null }> => {
    const rel = toMountRel(absolutePath);
    const r = await resolver.resolve(rel);
    if (rel === "") return { driveId: r.driveId, parentId: null };
    if (!r.page) throw new Error(`ENOENT: ${absolutePath}`);
    return { driveId: r.driveId, parentId: r.page.id };
  };

  // In PageSpace any page can have children, so a page is "directory-like" if it is a
  // FOLDER or has children. (A DOCUMENT with children — like `Brain` — is both listable
  // and readable.)
  const isDirectory = async (absolutePath: string): Promise<boolean> => {
    const rel = toMountRel(absolutePath);
    if (rel === "") return true;
    const r = await resolver.resolve(rel);
    if (!r.page) return false;
    if (r.page.type === "FOLDER") return true;
    return (await resolver.children(r.driveId, r.page.id)).length > 0;
  };

  return {
    isMountPath,
    read: {
      readFile: async (p) => Buffer.from(await readFileStr(p), "utf8"),
      access,
      detectImageMimeType: async () => null,
    },
    write: {
      writeFile: writeStr,
      mkdir: async (dir) => {
        const rel = toMountRel(dir);
        const r = await resolver.resolve(rel);
        if (r.page) return; // already exists
        await api.createPage({
          driveId: r.driveId,
          title: r.title,
          type: "FOLDER" as PageType,
          parentId: r.parentId,
        });
        resolver.invalidate(r.driveId);
      },
    },
    edit: {
      readFile: async (p) => Buffer.from(await readFileStr(p), "utf8"),
      writeFile: writeStr,
      access,
    },
    ls: {
      exists,
      stat: async (p) => {
        const dir = await isDirectory(p);
        return { isDirectory: () => dir };
      },
      readdir: async (p) => {
        const { driveId, parentId } = await containerId(p);
        const kids = await resolver.children(driveId, parentId);
        return kids.map((k) => k.title);
      },
    },
    find: {
      exists,
      glob: async (pattern, cwd, options) => {
        const rel = toMountRel(cwd);
        const r = await resolver.resolve(rel);
        const driveId = r.driveId;
        const startParent = rel === "" ? null : r.page ? r.page.id : null;
        const re = globToRegExp(pattern);
        const base = norm(cwd);
        const out: string[] = [];
        const walk = async (parentId: string | null, prefix: string) => {
          if (out.length >= options.limit) return;
          for (const k of await resolver.children(driveId, parentId)) {
            const childRel = prefix ? `${prefix}/${k.title}` : k.title;
            if (re.test(childRel) && !options.ignore.some((ig) => globToRegExp(ig).test(childRel))) {
              out.push(`${base}/${childRel}`);
              if (out.length >= options.limit) return;
            }
            if (k.type === "FOLDER") await walk(k.id, childRel);
          }
        };
        await walk(startParent, "");
        return out.slice(0, options.limit);
      },
    },
    grep: {
      isDirectory,
      readFile: readFileStr,
    },
    grepSearch: async (params: GrepParams): Promise<GrepResult> => {
      const limit = Math.max(1, params.limit ?? 100);
      const searchAbs = params.path ? norm(params.path) : mountRoot;
      const rel = toMountRel(searchAbs); // "" | "drive" | "drive/seg/..."
      const { driveSlug, segments } = rel
        ? PageSpaceResolverSplit(rel)
        : { driveSlug: config.defaultDriveSlug ?? "", segments: [] as string[] };
      if (!driveSlug) {
        throw new Error(
          "grep over the PageSpace mount needs a drive in the path (e.g. pagespace/<drive>/...) " +
            "or a configured default drive.",
        );
      }
      const r = await resolver.resolve(segments.length ? `${driveSlug}/${segments.join("/")}` : driveSlug);
      const driveId = r.driveId;

      // Server prefilter pattern: backslash-free + Postgres-safe (see helpers above).
      const serverPattern = params.literal
        ? literalToPgRegex(params.pattern, params.ignoreCase ?? false)
        : params.ignoreCase
          ? regexToCaseInsensitive(params.pattern)
          : params.pattern;

      const { results } = await api.regexSearch(driveId, serverPattern, "content", limit);

      // The server gives per-line previews only when `serverPattern` is a plain literal; otherwise
      // it returns matched pages only and we extract lines client-side with the JS regex.
      const serverGivesLines = !hasRegexMeta(serverPattern);
      const clientRe = serverGivesLines ? null : buildClientRegex(params);

      // Scope: keep only matches under the requested subtree, and present paths relative to it
      // (mirroring local grep, which prints paths relative to the search dir).
      const scopeRel = segments.length ? `${driveSlug}/${segments.join("/")}` : driveSlug;
      const globRe = params.glob ? globToRegExp(params.glob) : null;
      const MAX_LINE = 400;
      const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)} …[truncated]` : s);

      const lines: string[] = [];
      let matchLimitReached = false;
      outer: for (const m of results) {
        const stripped = m.semanticPath.replace(/^\/+/, ""); // "drive/seg/leaf"
        const inScope = stripped === scopeRel || stripped.startsWith(`${scopeRel}/`);
        if (!inScope) continue;
        const relPath =
          stripped === scopeRel ? stripped.split("/").pop()! : stripped.slice(scopeRel.length + 1);
        if (globRe && !globRe.test(relPath)) continue;

        let mls = m.matchingLines ?? [];
        if (clientRe) {
          // Fetch the matched page and extract real line matches client-side.
          try {
            mls = matchLinesIn(await api.readContent(m.pageId), clientRe);
          } catch {
            mls = [];
          }
        }
        for (const ml of mls) {
          if (lines.length >= limit) {
            matchLimitReached = true;
            break outer;
          }
          lines.push(`${relPath}:${ml.lineNumber}: ${clip(ml.content)}`);
        }
      }

      if (lines.length === 0) {
        return { content: [{ type: "text", text: "No matches found" }], details: undefined };
      }
      let text = lines.join("\n");
      if (matchLimitReached) {
        text += `\n\n[${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern]`;
      }
      return {
        content: [{ type: "text", text }],
        details: matchLimitReached ? { matchLimitReached: limit } : undefined,
      };
    },
  };
}

/** Local copy of PageSpaceResolver.split to keep this module import-light. */
function PageSpaceResolverSplit(mountRelPath: string): { driveSlug: string; segments: string[] } {
  const parts = mountRelPath.split("/").filter((p) => p.length > 0);
  return { driveSlug: parts[0] ?? "", segments: parts.slice(1) };
}
