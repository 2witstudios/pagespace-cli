import type { Drive, Page, PageSpaceApi } from "./api.ts";

export interface Resolved {
  driveId: string;
  driveSlug: string;
  /** The resolved page, or null when the final segment does not exist yet. */
  page: Page | null;
  /** Parent container page id (null = drive root). Set even when `page` is null, for creation. */
  parentId: string | null;
  /** The leaf segment (title) being addressed. */
  title: string;
}

/**
 * Resolves mount-relative paths (`<driveSlug>/<seg>/<seg>`) to PageSpace pages,
 * caching the drive list and each drive's page tree. Titles are matched verbatim.
 * Ambiguous (duplicate-title) siblings error rather than pick silently.
 */
export class PageSpaceResolver {
  private drivesBySlug: Map<string, Drive> | null = null;
  private childrenByDrive = new Map<string, Map<string | null, Page[]>>();

  constructor(private readonly api: PageSpaceApi) {}

  private async drives(): Promise<Map<string, Drive>> {
    if (!this.drivesBySlug) {
      const list = await this.api.listDrives();
      this.drivesBySlug = new Map(list.map((d) => [d.slug, d]));
    }
    return this.drivesBySlug;
  }

  private async childIndex(driveId: string): Promise<Map<string | null, Page[]>> {
    let idx = this.childrenByDrive.get(driveId);
    if (!idx) {
      idx = new Map();
      const tree = await this.api.listPages(driveId);
      const walk = (nodes: Page[], parentId: string | null) => {
        const list = idx!.get(parentId) ?? [];
        for (const n of nodes) {
          list.push(n);
          if (n.children?.length) walk(n.children, n.id);
        }
        idx!.set(parentId, list);
      };
      walk(tree, null);
      this.childrenByDrive.set(driveId, idx);
    }
    return idx;
  }

  /** Drop cached tree for a drive after a mutation. */
  invalidate(driveId?: string): void {
    if (driveId) this.childrenByDrive.delete(driveId);
    else this.childrenByDrive.clear();
  }

  async children(driveId: string, parentId: string | null): Promise<Page[]> {
    return (await this.childIndex(driveId)).get(parentId) ?? [];
  }

  private pick(siblings: Page[], title: string): Page | null {
    const hits = siblings.filter((p) => p.title === title);
    if (hits.length === 0) return null;
    if (hits.length > 1) {
      throw new Error(
        `Ambiguous path segment "${title}": ${hits.length} sibling pages share this title. Rename one, or address by id.`,
      );
    }
    return hits[0];
  }

  /** Split a mount-relative path into [driveSlug, ...segments]. */
  static split(mountRelPath: string): { driveSlug: string; segments: string[] } {
    const parts = mountRelPath.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) throw new Error("Empty PageSpace path");
    return { driveSlug: parts[0], segments: parts.slice(1) };
  }

  async resolve(mountRelPath: string): Promise<Resolved> {
    const { driveSlug, segments } = PageSpaceResolver.split(mountRelPath);
    const drive = (await this.drives()).get(driveSlug);
    if (!drive) throw new Error(`No accessible PageSpace drive with slug "${driveSlug}"`);

    // Path is the drive root itself.
    if (segments.length === 0) {
      return { driveId: drive.id, driveSlug, page: null, parentId: null, title: driveSlug };
    }

    let parentId: string | null = null;
    let page: Page | null = null;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const siblings = await this.children(drive.id, parentId);
      const found = this.pick(siblings, seg);
      if (i < segments.length - 1) {
        if (!found) {
          throw new Error(
            `Path not found: "${segments.slice(0, i + 1).join("/")}" under drive "${driveSlug}"`,
          );
        }
        parentId = found.id;
      } else {
        page = found; // may be null → does not exist yet (parentId is its container)
      }
    }
    return { driveId: drive.id, driveSlug, page, parentId, title: segments[segments.length - 1] };
  }
}
