import { open } from "node:fs/promises";

import {
  readElfRouteFacts,
  type ElfRouteFacts,
} from "../domain/pathInspectorRoutes.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { withOwnedFileHandle } from "../filesystem/OwnedRegularFile.js";

/**
 * The ELF facts that order a file's next inspectors, read from its headers.
 * `undefined` when the file is not a readable ELF file: routing then falls
 * back to the format's general probes, never to a failed inspection.
 */
export const readElfRouteFactsAt = async (
  path: string,
): Promise<ElfRouteFacts | undefined> => {
  try {
    return await withOwnedFileHandle(
      path,
      new OwnedFileHandle(await open(path, "r")),
      {},
      async (handle) => {
        const { size } = await handle.stat();
        return readElfRouteFacts(async (offset, length) => {
          if (offset >= size || length <= 0) return new Uint8Array(0);
          const buffer = Buffer.alloc(Math.min(length, size - offset));
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            offset,
          );
          return buffer.subarray(0, bytesRead);
        });
      },
    );
  } catch {
    return undefined;
  }
};
