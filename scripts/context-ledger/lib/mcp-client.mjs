// A minimal MCP client over stdio (newline-delimited JSON-RPC), so the ledger
// measures what the server sends without depending on any SDK version. It
// speaks the protocol version the audit's SDK client negotiated.
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2025-11-25";
const CLIENT_INFO = { name: "census-client", version: "0.0.1" };

/** One `rea mcp` server process and the requests sent to it. */
export const openMcp = async ({ rea, node, cwd, env, timeoutMs = 120_000 }) => {
  const child = spawn(node, [rea, "mcp"], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let exited = false;
  const pending = new Map();
  child.on("exit", () => {
    exited = true;
    for (const { reject } of pending.values())
      reject(new Error(`rea mcp exited; stderr: ${stderr.slice(-400)}`));
    pending.clear();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const dispatch = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else if (message.method !== undefined && message.id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "not supported by the ledger client" },
      });
    }
  };
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (let newline = buffer.indexOf("\n"); newline >= 0;) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() !== "") dispatch(line);
      newline = buffer.indexOf("\n");
    }
  });
  let nextId = 1;
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (exited) {
        reject(
          new Error(`rea mcp is not running; stderr: ${stderr.slice(-400)}`),
        );
        return;
      }
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      send({ jsonrpc: "2.0", id, method, params });
    });
  const close = async () => {
    if (exited) return;
    const gone = new Promise((resolve) => child.once("exit", resolve));
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await gone;
    clearTimeout(timer);
  };
  let initialize;
  try {
    initialize = await request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
  } catch (cause) {
    await close();
    throw cause;
  }
  if (initialize.error !== undefined) {
    await close();
    throw new Error(`initialize failed: ${JSON.stringify(initialize.error)}`);
  }
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return {
    initialize: initialize.result,
    request,
    close,
    /** Call a tool; returns the text the client forwards and the raw reply. */
    call: async (name, args = {}) => {
      const reply = await request("tools/call", { name, arguments: args });
      if (reply.error !== undefined)
        return {
          text: String(reply.error.message ?? ""),
          protocolError: reply.error,
        };
      const content = reply.result?.content ?? [];
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return {
        text,
        isError: reply.result?.isError === true,
        structured: reply.result?.structuredContent,
      };
    },
  };
};
