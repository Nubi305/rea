// Builders for task inputs. The repository tracks no binaries, so a binary
// input is built from the sources beside its task when a cell is prepared.
// Every builder hides the path of the task's sources from what it builds: an
// agent under test must not be led from an input to the answer's source.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

/** Tools a builder needs on PATH, by input kind. */
const TOOLS = { cc: ["gcc"], go: ["go"], pyc: ["python3"] };

const BUILD_TIMEOUT_MS = 180_000;

/** Every file under `root`, as sorted `/`-separated relative paths. */
export const listFiles = (root) => {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        found.push(relative(root, path).split(sep).join("/"));
    }
  };
  walk(root);
  return found.sort();
};

const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};
const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};

// 2026-01-01 00:00:00 in the DOS date and time of a zip entry, so that the
// same sources give the same archive on every machine.
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const zipEntry = (name, data, offset) => {
  const nameBytes = Buffer.from(name, "utf8");
  const packed = deflateRawSync(data, { level: 9 });
  const stored = packed.length >= data.length;
  const body = stored ? data : packed;
  // version needed, UTF-8 names, method, time, date, crc, sizes, name length
  const shared = Buffer.concat([
    u16(20),
    u16(0x0800),
    u16(stored ? 0 : 8),
    u16(ZIP_DOS_TIME),
    u16(ZIP_DOS_DATE),
    u32(crc32(data)),
    u32(body.length),
    u32(data.length),
    u16(nameBytes.length),
    u16(0),
  ]);
  const local = Buffer.concat([u32(0x04034b50), shared, nameBytes, body]);
  const central = Buffer.concat([
    u32(0x02014b50),
    u16(0x0314),
    shared,
    u16(0),
    u16(0),
    u16(0),
    u32((0o100644 << 16) >>> 0),
    u32(offset),
    nameBytes,
  ]);
  return { local, central };
};

/** A zip archive of `files` ({ name, data }), in the order given. */
export const zipArchive = (files) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const entry = zipEntry(name, data, offset);
    locals.push(entry.local);
    centrals.push(entry.central);
    offset += entry.local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, directory, end]);
};

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: BUILD_TIMEOUT_MS,
    encoding: "utf8",
    ...options,
  });

/** A private copy of a source directory, so that no tool writes into the repository. */
const stagedCopy = (source) => {
  const stage = mkdtempSync(join(tmpdir(), "rea-bench-input-"));
  cpSync(source, join(stage, "src"), { recursive: true });
  return { stage, root: join(stage, "src") };
};

const builders = {
  copy: ({ from, to }, { taskDir, outDir }) => {
    cpSync(join(taskDir, from), join(outDir, to), { recursive: true });
  },
  zip: ({ from, to }, { taskDir, outDir }) => {
    const root = join(taskDir, from);
    const files = listFiles(root).map((name) => ({
      name,
      data: readFileSync(join(root, name)),
    }));
    writeFileSync(join(outDir, to), zipArchive(files));
  },
  cc: ({ from, sources, to, flags = [] }, { taskDir, outDir }) => {
    const { stage, root } = stagedCopy(join(taskDir, from));
    try {
      // The debug information names /src, never the staging directory.
      run(
        "gcc",
        [
          `-fdebug-prefix-map=${root}=/src`,
          ...flags.filter((flag) => !flag.startsWith("-l")),
          "-o",
          join(outDir, to),
          ...sources,
          ...flags.filter((flag) => flag.startsWith("-l")),
        ],
        { cwd: root },
      );
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  },
  go: ({ from, to, flags = [], env = {} }, { taskDir, outDir }) => {
    const { stage, root } = stagedCopy(join(taskDir, from));
    try {
      run("go", ["build", "-trimpath", ...flags, "-o", join(outDir, to), "."], {
        cwd: root,
        env: {
          ...process.env,
          GOTOOLCHAIN: "local",
          GOPROXY: "off",
          GOFLAGS: "-buildvcs=false",
          ...env,
        },
      });
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  },
  pyc: ({ from, to, name }, { taskDir, outDir }) => {
    const code =
      "import py_compile,sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], dfile=sys.argv[3], doraise=True)";
    run("python3", [
      "-I",
      "-c",
      code,
      join(taskDir, from),
      join(outDir, to),
      name,
    ]);
  },
  sqlite: ({ from, to }, { taskDir, outDir }) => {
    const code =
      "const { DatabaseSync } = require('node:sqlite'); const fs = require('node:fs');" +
      "const db = new DatabaseSync(process.argv[2]); db.exec(fs.readFileSync(process.argv[1], 'utf8')); db.close();";
    run(process.execPath, [
      "--no-warnings",
      "-e",
      code,
      join(taskDir, from),
      join(outDir, to),
    ]);
  },
  node: ({ script, to }, { taskDir, outDir }) => {
    run(process.execPath, [join(taskDir, script), join(outDir, to)]);
  },
};

const onPath = (tool) =>
  (process.env.PATH ?? "")
    .split(":")
    .some((directory) => directory !== "" && existsSync(join(directory, tool)));

/** The tools the inputs of a task need that are not on PATH. */
export const missingInputTools = (inputs) => [
  ...new Set(
    inputs
      .flatMap((input) => TOOLS[input.kind] ?? [])
      .filter((tool) => !onPath(tool)),
  ),
];

/**
 * Build every input of a task into `outDir`, in the order the task lists
 * them. An input is `{ kind, to, ... }`; `to` is relative to `outDir` and may
 * not leave it.
 */
export const buildInputs = (inputs, { taskDir, outDir }) => {
  mkdirSync(outDir, { recursive: true });
  for (const input of inputs) {
    const build = builders[input.kind];
    if (build === undefined)
      throw new Error(`unknown input kind ${JSON.stringify(input.kind)}`);
    const target = resolve(outDir, input.to);
    if (!target.startsWith(resolve(outDir) + sep))
      throw new Error(`input ${input.to} leaves the input directory`);
    mkdirSync(dirname(target), { recursive: true });
    build(input, { taskDir, outDir });
    if (!existsSync(target))
      throw new Error(`input ${input.to} was not built (${input.kind})`);
  }
  return listFiles(outDir).map((name) => ({
    name,
    bytes: statSync(join(outDir, name)).size,
  }));
};
