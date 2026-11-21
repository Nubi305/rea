import { expect } from "vitest";

import { PRODUCT_IDENTITY } from "../../src/identity.js";
import { workspaceCliTest } from "../support/cli/workspaceCliFixture.js";

workspaceCliTest.skipIf(process.platform === "win32")(
  "prints no update notice on a fork build, in any result document",
  async ({ cli, workspace }) => {
    await workspace.write("sample.bin", Buffer.from("notice fixture"));
    await workspace.write(
      `cache/incur/updates/${PRODUCT_IDENTITY.packageName}.json`,
      JSON.stringify({ checkedAt: Date.now(), latest: "999.0.0" }),
    );
    const environment = {
      ...workspace.environment,
      XDG_CACHE_HOME: workspace.path("cache"),
      npm_config_registry: "http://127.0.0.1:9/",
    };
    const run = async (
      arguments_: readonly string[],
      stderrContains?: string,
    ) => {
      const result = await cli.run({
        arguments: arguments_,
        cwd: workspace.root,
        environment,
        terminal: true,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      if (stderrContains === undefined) expect(result.stderr).toBe("");
      else expect(result.stderr).toContain(stderrContains);
      return result.stdout;
    };
    const entropy = ["inspect-byte-entropy", workspace.path("sample.bin")];
    const notice = "Update available for rea-agents:";
    // This build is a fork: npm's newer release is upstream's build, which
    // would remove the fork's commands, so no notice offers it.
    expect(await run(entropy)).not.toContain(notice);
    expect(await run([...entropy, "--full-output"])).not.toContain(notice);
    for (const flags of [[], ["--full-output"], ["--token-limit", "10"]]) {
      const output = await run([
        ...entropy,
        "--filter-output",
        "normalized_result.window",
        ...flags,
      ]);
      expect(output).toContain("offset");
      expect(output).not.toContain(notice);
    }
    expect(
      await run(
        ["setup", "--dry-run", "--client", "codex", "--token-limit", "1"],
        "Dry run complete. No changes were made.",
      ),
    ).not.toContain(notice);
  },
);
