import { describe, expect, it } from "vitest";

import { searchCommands } from "./CommandSearch.js";

const commands = [
  {
    name: "inspect-api-contract",
    description: "Inspect local OpenAPI JSON or GraphQL SDL declarations",
  },
  { name: "open-jeb-project", description: "Open or create a JEB project" },
  {
    name: "inspect-evm-interface",
    description: "Infer interface candidates from EVM bytecode",
  },
  {
    name: "inspect-web-network-capture",
    description: "Inspect retained HAR records",
  },
];

describe("searchCommands", () => {
  it("finds a word in a name or a description, by short endings too", () => {
    expect(searchCommands(commands, "openapi").map(({ name }) => name)).toEqual(
      ["inspect-api-contract"],
    );
    expect(searchCommands(commands, "evm").map(({ name }) => name)).toEqual([
      "inspect-evm-interface",
    ]);
    expect(
      searchCommands(commands, "captures").map(({ name }) => name),
    ).toEqual(["inspect-web-network-capture"]);
  });

  it("ranks by how many words a command covers and needs half of them", () => {
    const found = searchCommands(commands, "inspect evm bytecode");
    expect(found[0]).toMatchObject({
      name: "inspect-evm-interface",
      matched: ["inspect", "evm", "bytecode"],
    });
    expect(searchCommands(commands, "evm har zip unknown")).toEqual([]);
  });

  it("finds nothing for generic words alone", () => {
    expect(searchCommands(commands, "the of and")).toEqual([]);
  });
});
