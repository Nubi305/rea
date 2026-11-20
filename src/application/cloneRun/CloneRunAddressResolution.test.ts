import { expect, it } from "vitest";

import { CLONE_RUN_THIS_MACHINE } from "../../domain/cloneRun/cloneRunSchemas.js";
import {
  cloneRunAddressConflict,
  normaliseCloneRunIp,
  resolveCloneRunAddress,
  type CloneRunHostResolver,
} from "./CloneRunAddressResolution.js";

/** A machine with one interface address and a resolver that knows three names. */
const resolver = (lookups: string[] = []): CloneRunHostResolver => ({
  lookup: (host) => {
    lookups.push(host);
    const known: Readonly<Record<string, readonly string[]>> = {
      vm: ["127.0.0.1"],
      "alias.test": ["::ffff:127.0.0.1"],
      "lan.test": ["192.0.2.10"],
      "far.test": ["198.51.100.7", "2001:db8::7"],
      "other.test": ["198.51.100.8"],
    };
    const addresses = known[host];
    return addresses === undefined
      ? Promise.reject(new Error(`getaddrinfo ENOTFOUND ${host}`))
      : Promise.resolve(addresses);
  },
  interfaceAddresses: () => ["192.0.2.10", "fe80::1%eth0"],
});

const conflict = async (original: string, clone: string) =>
  (await cloneRunAddressConflict(original, clone, resolver()))?.relation ??
  "distinct";

it("writes one spelling for every form of an IP literal", () => {
  expect(normaliseCloneRunIp("127.0.0.1")).toBe("127.0.0.1");
  expect(normaliseCloneRunIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
  expect(normaliseCloneRunIp("::ffff:7f00:1")).toBe("127.0.0.1");
  expect(normaliseCloneRunIp("::1")).toBe("0:0:0:0:0:0:0:1");
  expect(normaliseCloneRunIp("FE80::1%eth0")).toBe("fe80:0:0:0:0:0:0:1");
  expect(normaliseCloneRunIp("2001:db8::7")).toBe("2001:db8:0:0:0:0:0:7");
  expect(normaliseCloneRunIp("localhost")).toBeUndefined();
});

it("folds every way of naming this machine to one host", async () => {
  for (const origin of [
    "http://127.0.0.1:4810",
    "http://127.0.0.2:4810",
    "http://127.1:4810",
    "http://2130706433:4810",
    "http://0x7f.0.0.1:4810",
    "http://0.0.0.0:4810",
    "http://[::1]:4810",
    "http://[::]:4810",
    "http://[::ffff:127.0.0.1]:4810",
    "http://[::ffff:7f00:1]:4810",
    "http://localhost:4810",
    "http://LOCALHOST:4810",
    "http://localhost.:4810",
    "http://app.localhost:4810",
    "http://127.0.0.1.:4810",
    // A name from the hosts file, a name that resolves to a mapped loopback, and this machine's own interface.
    "http://vm:4810",
    "http://alias.test:4810",
    "http://192.0.2.10:4810",
    "http://lan.test:4810",
    "http://[fe80::1]:4810",
  ])
    expect(
      (await resolveCloneRunAddress(origin, resolver())).hosts,
      origin,
    ).toEqual([CLONE_RUN_THIS_MACHINE]);
  expect(await resolveCloneRunAddress("https://far.test", resolver())).toEqual({
    port: "443",
    host: "far.test",
    hosts: ["198.51.100.7", "2001:db8:0:0:0:0:0:7"],
  });
});

it("refuses an alias of the original's address and lets two real servers through", async () => {
  const original = "http://127.0.0.1:4810";
  for (const alias of [
    "http://localhost.:4810",
    "http://[::ffff:127.0.0.1]:4810",
    "http://vm:4810",
    "http://alias.test:4810",
    "http://lan.test:4810",
    // One port of one host is one listener, whatever the scheme says.
    "https://127.0.0.1:4810",
  ])
    expect(await conflict(original, alias), alias).toBe("same");
  expect(await conflict("http://far.test", "http://198.51.100.7:80")).toBe(
    "same",
  );
  expect(await conflict(original, "http://127.0.0.1:4811")).toBe("distinct");
  expect(await conflict(original, "http://far.test:4810")).toBe("distinct");
  expect(await conflict("http://far.test", "http://other.test")).toBe(
    "distinct",
  );
});

it("leaves identity unknown when a host does not resolve, and says which host", async () => {
  const unknown = await cloneRunAddressConflict(
    "http://127.0.0.1:4810",
    "http://nowhere.test:4810",
    resolver(),
  );
  expect(unknown?.relation).toBe("unknown");
  expect(unknown?.message).toContain(
    "the clone's host nowhere.test did not resolve (getaddrinfo ENOTFOUND nowhere.test)",
  );
  // Two ports are two listeners: nothing is resolved, so a slow or absent resolver costs nothing.
  const lookups: string[] = [];
  expect(
    await cloneRunAddressConflict(
      "http://nowhere.test:4810",
      "http://elsewhere.test:4811",
      resolver(lookups),
    ),
  ).toBeUndefined();
  expect(lookups).toEqual([]);
});
