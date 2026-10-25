import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { TOOLS, type McpHost, type ToolResult } from "./tools";

/**
 * The MCP server's protocol side. Rust passes each JSON-RPC message from an
 * agent here as an `mcp-request` event (see src-tauri/src/mcp.rs) and sends
 * back whatever `mcp_reply` returns.
 */

type JsonRpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Reply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `LabelPad designs and prints labels on Niimbot D11 and M3 printers.
Typical flow: get_status, connect_printer (no arguments reconnects the last printer), new_label or open_label,
add_element / update_element, preview_label to check the result, then print_label and save_label.
Sizes and positions are in millimeters on the label as the editor shows it, from its top-left corner.
Changes appear live in the LabelPad window and can be undone there.`;

/** Answer the agents' messages until unmounted. */
export function useMcpServer(host: RefObject<McpHost>) {
  useEffect(() => {
    const off = listen<{ key: number; message: JsonRpc }>("mcp-request", async ({ payload }) => {
      const response = await answer(payload.message, host);
      await invoke("mcp_reply", { key: payload.key, response }).catch(() => undefined);
    });
    // Only now is there someone to answer, so only now does the app take connections.
    void off.then(() => invoke("mcp_ready")).catch(() => undefined);
    return () => void off.then((f) => f());
  }, [host]);
}

/** Tool calls run one at a time, as a person's clicks would. */
let queue: Promise<unknown> = Promise.resolve();

async function answer(msg: JsonRpc, host: RefObject<McpHost>): Promise<Reply | null> {
  // Notifications (no id) get no reply.
  if (msg.id === undefined || !msg.method) return null;
  const id = msg.id;
  const ok = (result: unknown): Reply => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): Reply => ({ jsonrpc: "2.0", id, error: { code, message } });
  const params = msg.params ?? {};

  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "labelpad", title: "LabelPad", version: await getVersion().catch(() => "0.0.0") },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ run: _run, ...tool }) => tool) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(params.name)}`);
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const run = queue.then(() => tool.run(args, () => host.current!));
      queue = run.catch(() => undefined);
      try {
        return ok(await run);
      } catch (e) {
        return ok({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true } satisfies ToolResult);
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}
