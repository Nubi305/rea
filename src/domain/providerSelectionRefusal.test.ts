import { describe, expect, it } from "vitest";

import { projectAnalysisError } from "./analysisErrorProjection.js";
import { providerFreeCommands } from "./pathInspectorRoutes.js";
import { ProviderSelectionError } from "./providerSelectionError.js";

const rejections = [
  {
    providerId: "ghidra",
    origin: "availability" as const,
    code: "not_configured",
    reason: "Set GHIDRA_INSTALL_DIR to a Ghidra 12.x release directory.",
    remediation: "Set GHIDRA_INSTALL_DIR to a Ghidra 12.x release directory.",
    diagnostics: { install_dir: null, java_command: "/usr/bin/java" },
  },
  {
    providerId: "kuna",
    origin: "availability" as const,
    code: "not_configured",
    reason:
      "Set REA_KUNA_COMMAND to a kuna executable (verified with 1.1000). REA does not install Kuna.",
    remediation:
      "Set REA_KUNA_COMMAND to a kuna executable (verified with 1.1000). REA does not install Kuna.",
    diagnostics: { configured: false },
  },
];

const refusal = (requestedProviderId: string) =>
  projectAnalysisError(
    new ProviderSelectionError({
      operation: "decompile_function",
      reason: "provider_unavailable",
      requestedProviderId,
      candidateIds: ["ghidra", "kuna"],
      rejections,
      withoutProvider: providerFreeCommands("/work/licensed", "elf"),
    }),
  );

describe("the refusal for a missing analysis provider", () => {
  it("prints one fix per candidate and the commands that need no provider", () => {
    const projected = refusal("auto");
    expect(projected.message).toBe(
      "No analysis provider is ready; none refused this target.",
    );
    expect(projected.details).toMatchObject({
      rejections: [
        {
          provider_id: "ghidra",
          origin: "availability",
          code: "not_configured",
          fix: "Set GHIDRA_INSTALL_DIR to a Ghidra 12.x release directory.",
        },
        {
          provider_id: "kuna",
          origin: "availability",
          code: "not_configured",
          fix: "Set REA_KUNA_COMMAND to a kuna executable (verified with 1.1000).",
        },
      ],
      without_provider: [
        "rea inspect-binary-hardening /work/licensed",
        "rea inspect-elf-dependencies /work/licensed",
        "rea inspect-with-objdump /work/licensed symbols",
        "rea inspect-with-objdump /work/licensed disassemble --symbol SYMBOL",
        "rea debug-with-gdb 'x/s ADDRESS' --executable /work/licensed",
      ],
    });
    expect(JSON.stringify(projected.details)).not.toContain("java_command");
  });

  it("keeps every reason and diagnostic when the caller named the provider", () => {
    const projected = refusal("ghidra");
    expect(projected.details).toMatchObject({
      rejections: [
        {
          provider_id: "ghidra",
          reason: rejections[0]!.reason,
          diagnostics: rejections[0]!.diagnostics,
        },
        { provider_id: "kuna", diagnostics: { configured: false } },
      ],
    });
  });
});
