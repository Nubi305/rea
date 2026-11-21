import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { availableUpdate } from "../../../src/cli/updateNotice.js";
import { FORK_IDENTITY } from "../../../src/domain/forkIdentity.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("shows no update notice and asks no registry for a fork build", async () => {
  const root = await createTestTempDirectory("rea-fork-notice-");
  const directory = join(root, "incur", "updates");
  await mkdir(directory, { recursive: true });
  const file = join(
    directory,
    `${encodeURIComponent(PRODUCT_IDENTITY.packageName)}.json`,
  );
  // A stale cache would schedule a detached registry refresh.
  const stale = `${JSON.stringify({ checkedAt: 0, latest: "999.0.0" })}\n`;
  await writeFile(file, stale);
  const environment = {
    variables: { XDG_CACHE_HOME: root },
    platform: process.platform,
  };
  expect(
    availableUpdate("rea", "1.0.0", environment, FORK_IDENTITY),
  ).toBeUndefined();
  expect(await readFile(file, "utf8")).toBe(stale);

  // The same cache without the fork marker names upstream's release.
  await writeFile(
    file,
    `${JSON.stringify({ checkedAt: Date.now(), latest: "999.0.0" })}\n`,
  );
  expect(availableUpdate("rea", "1.0.0", environment, undefined)).toMatchObject(
    { latest: "999.0.0", current: "1.0.0" },
  );
});
