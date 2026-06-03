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
  glob: (
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ) => Promise<string[]>;
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
}

export interface PageSpaceOps {
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
  ls: LsOperations;
  find: FindOperations;
  grep: GrepOperations;
  /** True when an absolute path falls under the PageSpace mount. */
  isMountPath: (absolutePath: string) => boolean;
}

function norm(p: string): string {
  return p.replace(/\/+/g, "/").replace(/\/$/, "");
}

function globToRegExp(pattern: string): RegExp {
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
    else if ("\\^$+.()|{}[]".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
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
    return p === mountRoot || p.startsWith(mountRoot + "/");
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
  };
}
