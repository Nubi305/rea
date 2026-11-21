import { readlink } from "node:fs/promises";
import { join } from "node:path";

import { CLEAN_ROOM_MIN_IDENTICAL_BYTES } from "../../domain/cloneRun/cloneRunSchemas.js";
import { readCloneTreeFile, type CloneTreeFile } from "./CloneRunTreeDigest.js";

/**
 * The clean-room check of a clone run: no clone file is a copy of a file
 * taken from the original, and none of the original's names occurs in the
 * clone. Contract: docs/reference/clone-runs.md, "What done means", check 7.
 */

/** Where a digest of the original's own bytes was seen. */
export interface OriginalFileSource {
  readonly sha256: string;
  /** A material path or a request line, for the worklist message. */
  readonly source: string;
}

/** Clone files of 64 bytes or more whose digest is one of the original's, with where it was seen. */
export const identicalCloneFiles = (
  files: readonly CloneTreeFile[],
  originals: readonly OriginalFileSource[],
): readonly { readonly path: string; readonly source: string }[] => {
  const sources = new Map<string, string>();
  for (const { sha256, source } of originals)
    if (!sources.has(sha256)) sources.set(sha256, source);
  return files.flatMap((file) => {
    const source =
      file.kind === "file" && file.bytes >= CLEAN_ROOM_MIN_IDENTICAL_BYTES
        ? sources.get(file.sha256)
        : undefined;
    return source === undefined ? [] : [{ path: file.path, source }];
  });
};

const asciiLower = (text: string): string =>
  text.replaceAll(/[A-Z]+/gu, (letters) => letters.toLowerCase());

/** The first needle found in a file's bytes, ignoring ASCII case; the file is read as a stream. */
const firstNameInFile = async (
  path: string,
  needles: readonly { readonly name: string; readonly bytes: Buffer }[],
  overlap: number,
): Promise<string | undefined> => {
  let found: string | undefined;
  // The tail of the previous chunk stays in front, so a name that spans two reads is found.
  let carried: Buffer = Buffer.alloc(0);
  await readCloneTreeFile(path, (chunk) => {
    const view = Buffer.concat([carried, chunk]);
    for (let index = carried.length; index < view.length; index += 1) {
      const byte = view[index] ?? 0;
      if (byte >= 0x41 && byte <= 0x5a) view[index] = byte | 0x20;
    }
    found = needles.find(({ bytes }) => view.includes(bytes))?.name;
    if (found !== undefined) return "stop";
    carried = view.subarray(Math.max(0, view.length - overlap));
    return undefined;
  });
  return found;
};

/**
 * Clone files whose bytes or relative path contain one of the original's
 * names, ignoring ASCII case, each with the first name found. A name is a
 * plain substring. A link is checked by its path and by its link text, which
 * the tree digest treats as its content; it is never followed. A file or link
 * that vanished since the tree was digested names nothing.
 */
export const cloneFilesNamingOriginal = async (
  root: string,
  files: readonly CloneTreeFile[],
  names: readonly string[],
): Promise<
  readonly {
    readonly path: string;
    readonly name: string;
    readonly where: "path" | "content" | "link";
  }[]
> => {
  const needles = names.map((name) => ({
    name,
    lowered: asciiLower(name),
    bytes: Buffer.from(asciiLower(name), "utf8"),
  }));
  const overlap = Math.max(0, ...needles.map(({ bytes }) => bytes.length - 1));
  const found: {
    readonly path: string;
    readonly name: string;
    readonly where: "path" | "content" | "link";
  }[] = [];
  const vanished = (cause: unknown): undefined => {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return undefined;
    throw cause;
  };
  for (const file of files) {
    const loweredPath = asciiLower(file.path);
    const inPath = needles.find(({ lowered }) => loweredPath.includes(lowered));
    if (inPath !== undefined) {
      found.push({ path: file.path, name: inPath.name, where: "path" });
      continue;
    }
    if (file.kind === "symlink") {
      const text = await readlink(join(root, file.path)).catch(vanished);
      const loweredText = text === undefined ? "" : asciiLower(text);
      const inText = needles.find(({ lowered }) =>
        loweredText.includes(lowered),
      );
      if (inText !== undefined)
        found.push({ path: file.path, name: inText.name, where: "link" });
      continue;
    }
    const inContent = await firstNameInFile(
      join(root, file.path),
      needles,
      overlap,
    ).catch(vanished);
    if (inContent !== undefined)
      found.push({ path: file.path, name: inContent, where: "content" });
  }
  return found;
};
