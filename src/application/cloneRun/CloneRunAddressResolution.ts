import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

import {
  CLONE_RUN_THIS_MACHINE,
  cloneRunAddressRelation,
  type CloneRunAddressRelation,
  type CloneRunResolvedAddress,
} from "../../domain/cloneRun/cloneRunSchemas.js";
import { errorMessage } from "../../kernel/errorMessage.js";

/**
 * What the two addresses of a clone run reach. A host name cannot be
 * classified by its spelling, so every name that is not an IP literal goes to
 * the system resolver, and every loopback, unspecified and own-interface
 * address is folded to "this machine".
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, check 1 (scope).
 */

/** The system facts address identity needs; tests supply fakes. */
export interface CloneRunHostResolver {
  /** Every address the system resolver gives for a host name; rejects when the name does not resolve. */
  readonly lookup: (host: string) => Promise<readonly string[]>;
  /** The addresses of this machine's own network interfaces. */
  readonly interfaceAddresses: () => readonly string[];
}

/** A resolver that never answers reads as a name that did not resolve. */
const LOOKUP_TIMEOUT_MS = 5000;

export const SYSTEM_HOST_RESOLVER: CloneRunHostResolver = {
  lookup: async (host) =>
    (await lookup(host, { all: true, verbatim: true })).map(
      ({ address }) => address,
    ),
  interfaceAddresses: () =>
    Object.values(networkInterfaces()).flatMap((addresses) =>
      (addresses ?? []).map(({ address }) => address),
    ),
};

/** The eight groups of an IPv6 literal, or undefined when the text is not one. */
const ipv6Groups = (text: string): readonly number[] | undefined => {
  if (isIP(text) !== 6) return undefined;
  let source = text;
  // A dotted IPv4 tail stands for the last two groups.
  const tail = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/u.exec(source);
  if (tail !== null) {
    const [, head = "", a = "0", b = "0", c = "0", d = "0"] = tail;
    source = `${head}${((Number(a) << 8) | Number(b)).toString(16)}:${(
      (Number(c) << 8) |
      Number(d)
    ).toString(16)}`;
  }
  const [left = "", right] = source.split("::");
  const parse = (part: string): number[] =>
    part === "" ? [] : part.split(":").map((group) => parseInt(group, 16));
  const head = parse(left);
  const rest = right === undefined ? [] : parse(right);
  const groups =
    right === undefined
      ? head
      : [
          ...head,
          ...Array<number>(Math.max(0, 8 - head.length - rest.length)).fill(0),
          ...rest,
        ];
  return groups.length === 8 ? groups : undefined;
};

/**
 * One IP literal in the spelling identities are compared in: dotted IPv4,
 * also for an IPv4-mapped IPv6 address, and eight lower-case groups for any
 * other IPv6 address. A zone index is dropped. Undefined for a host name.
 */
export const normaliseCloneRunIp = (literal: string): string | undefined => {
  const text = literal.replace(/%.*$/u, "").toLowerCase();
  if (isIP(text) === 4) return text;
  const groups = ipv6Groups(text);
  if (groups === undefined) return undefined;
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff)
    return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  return groups.map((group) => group.toString(16)).join(":");
};

const LOOPBACK_V6 = "0:0:0:0:0:0:0:1";
const UNSPECIFIED_V6 = "0:0:0:0:0:0:0:0";

/** Whether a normalised IP is a loopback or unspecified address: always this machine. */
const reachesThisMachine = (ip: string): boolean =>
  ip.startsWith("127.") ||
  ip === "0.0.0.0" ||
  ip === LOOPBACK_V6 ||
  ip === UNSPECIFIED_V6;

/** Browsers answer `localhost` and every name under it from loopback without asking a resolver. */
const LOCALHOST_NAME = /^(?:.+\.)?localhost$/u;

const withTimeout = async <Value>(
  work: Promise<Value>,
  milliseconds: number,
): Promise<Value> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`the resolver did not answer in ${milliseconds} ms`),
          );
        }, milliseconds);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const effectivePort = (url: URL): string =>
  url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;

/** One address as resolved, with what to say when its host did not resolve. */
export interface CloneRunAddressResolution extends CloneRunResolvedAddress {
  /** The host as compared: lower case, without brackets or one trailing dot. */
  readonly host: string;
  /** Why `hosts` is null. */
  readonly unresolved?: string;
}

/**
 * Resolve one origin that `browserOriginSchema` accepted. The URL parser has
 * already normalised IPv4 spellings (`127.1`, `0x7f.0.0.1`, a decimal number)
 * and IPv6 literals; one trailing dot of a name is stripped here.
 */
export const resolveCloneRunAddress = async (
  origin: string,
  resolver: CloneRunHostResolver,
): Promise<CloneRunAddressResolution> => {
  const url = new URL(origin);
  const port = effectivePort(url);
  const host = url.hostname
    .replace(/^\[(.*)\]$/u, "$1")
    .replace(/\.$/u, "")
    .toLowerCase();
  const own = new Set(
    resolver
      .interfaceAddresses()
      .flatMap((address) => normaliseCloneRunIp(address) ?? []),
  );
  const identity = (ip: string): string =>
    reachesThisMachine(ip) || own.has(ip) ? CLONE_RUN_THIS_MACHINE : ip;
  const literal = normaliseCloneRunIp(host);
  if (literal !== undefined) return { port, host, hosts: [identity(literal)] };
  if (LOCALHOST_NAME.test(host))
    return { port, host, hosts: [CLONE_RUN_THIS_MACHINE] };
  let addresses: readonly string[];
  try {
    addresses = await withTimeout(resolver.lookup(host), LOOKUP_TIMEOUT_MS);
  } catch (cause: unknown) {
    return { port, host, hosts: null, unresolved: errorMessage(cause) };
  }
  const hosts = [
    ...new Set(
      addresses.flatMap((address) => {
        const ip = normaliseCloneRunIp(address);
        return ip === undefined ? [] : [identity(ip)];
      }),
    ),
  ];
  return hosts.length === 0
    ? { port, host, hosts: null, unresolved: "the resolver gave no address" }
    : { port, host, hosts };
};

/** Why two addresses are not shown to be distinct, for a refusal or a finding; undefined when they are. */
export interface CloneRunAddressConflict {
  readonly relation: Exclude<CloneRunAddressRelation, "distinct">;
  /** One sentence that names the true cause. */
  readonly message: string;
}

const describeHosts = (resolution: CloneRunAddressResolution): string =>
  (resolution.hosts ?? [])
    .map((host) => (host === CLONE_RUN_THIS_MACHINE ? "this machine" : host))
    .join(", ");

/**
 * Whether the original's and the clone's address can be one server. Hosts
 * are resolved only when the ports are equal: two ports are two listeners
 * whatever their hosts are.
 */
export const cloneRunAddressConflict = async (
  original: string,
  clone: string,
  resolver: CloneRunHostResolver,
): Promise<CloneRunAddressConflict | undefined> => {
  const unresolved = { hosts: null } as const;
  const port = (origin: string): string => effectivePort(new URL(origin));
  if (
    cloneRunAddressRelation(
      { port: port(original), ...unresolved },
      { port: port(clone), ...unresolved },
    ) === "distinct"
  )
    return undefined;
  const [left, right] = await Promise.all([
    resolveCloneRunAddress(original, resolver),
    resolveCloneRunAddress(clone, resolver),
  ]);
  const relation = cloneRunAddressRelation(left, right);
  if (relation === "distinct") return undefined;
  if (relation === "same")
    return {
      relation,
      message: `The original (${original}) and the clone (${clone}) are one address: both use port ${left.port}, and ${left.host} (${describeHosts(left)}) and ${right.host} (${describeHosts(right)}) reach the same host. Every loopback name and address, 0.0.0.0 and each address of this machine's own interfaces count as this machine, and a host name counts as the addresses the system resolver gives for it.`,
    };
  const unknown = [
    ["original", left] as const,
    ["clone", right] as const,
  ].filter(([, resolution]) => resolution.hosts === null);
  return {
    relation,
    message: `The original (${original}) and the clone (${clone}) both use port ${left.port}, and REA cannot tell whether they are one server: ${unknown
      .map(
        ([side, resolution]) =>
          `the ${side}'s host ${resolution.host} did not resolve (${resolution.unresolved ?? "no address"})`,
      )
      .join(
        " and ",
      )}. Until both hosts resolve, the two addresses are treated as one.`,
  };
};
