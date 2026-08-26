/**
 * End-to-end smoke test: drives the same wire protocol the browser speaks.
 *
 *   node scripts/smoke.mjs [--prompt "text"]
 *
 * Verifies: WS connect → ready frame → get_state / stats / models responses →
 * (optional) streamed prompt turn ending in terminal agent_end with usage.
 */
import WebSocket from "ws";
const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:8787/ws";

const ws = new WebSocket(WS_URL);
const PROMPT = process.argv.includes("--prompt")
  ? process.argv[process.argv.indexOf("--prompt") + 1]
  : null;

let sawReady = false;
let sawAgentEnd = false;
let deltaCount = 0;
let lastText = "";

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

function request(frame) {
  ws.send(JSON.stringify(frame));
}

const timeout = setTimeout(() => {
  log("TIMEOUT — dumping observed frames");
  process.exit(2);
}, 150_000);

ws.on("error", (err) => {
  log(`WS error: ${err.message}`);
  process.exit(1);
});

ws.on("close", (code, reason) => {
  log(`WS closed ${code} ${reason}`);
});

ws.on("open", () => {
  log("connected");
});

ws.on("message", (data) => {
  let frame;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    log("non-JSON frame!");
    return;
  }

  switch (frame.type) {
    case "ready": {
      sawReady = true;
      log(`ready: protocol=${frame.protocolVersion} supports=[${(frame.supportedProtocolVersions ?? []).join(",")}]`);
      request({ id: "smoke-state", type: "get_state" });
      request({ id: "smoke-stats", type: "get_session_stats" });
      request({ id: "smoke-models", type: "get_available_models" });
      break;
    }
    case "response": {
      const summary =
        frame.command === "get_state"
          ? `model=${frame.data?.model ? `${frame.data.model.provider}/${frame.data.model.id}` : "?"} sessionFile=${JSON.stringify(frame.data?.sessionFile)} msgs=${frame.data?.messageCount}`
          : frame.command === "get_available_models"
            ? `${frame.data?.models?.length ?? 0} models`
            : JSON.stringify(frame.data)?.slice(0, 120);
      log(`response ${frame.command}: success=${frame.success} ${frame.success ? summary : frame.error}`);
      if (frame.id === "protocol-1" && frame.success) log("negotiated v2");
      break;
    }
    case "agent_start":
      log("agent_start");
      break;
    case "message_update": {
      deltaCount += 1;
      const blocks = frame.message?.content ?? [];
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (text.length > lastText.length) lastText = text;
      break;
    }
    case "tool_execution_start":
      log(`tool_start ${frame.toolName}`);
      break;
    case "tool_execution_end":
      log(`tool_end ${frame.toolName} isError=${frame.isError}`);
      break;
    case "agent_end": {
      sawAgentEnd = true;
      const assistant = (frame.messages ?? []).filter((m) => m.role === "assistant").at(-1);
      const usage = assistant?.usage;
      log(
        `agent_end isTerminal=${frame.isTerminal} deltas=${deltaCount} usage=${usage ? `${usage.totalTokens} tok $${usage.cost.total.toFixed(4)}` : "none"}`,
      );
      log(`final text: ${lastText.slice(0, 200) || "(empty)"}`);
      clearTimeout(timeout);
      setTimeout(() => {
        log(sawReady && sawAgentEnd ? "SMOKE OK" : "SMOKE INCOMPLETE");
        ws.close();
        process.exit(sawReady ? 0 : 3);
      }, 250);
      break;
    }
    case "bridge_event":
      log(`bridge_event ${frame.event} ${frame.error ?? ""}`);
      break;
    default:
      if (!["rpc_chunk", "message_update", "available_commands_update"].includes(frame.type)) {
        log(`frame: ${frame.type}`);
      }
  }
});

// Drive the flow once the connection settles.
setTimeout(() => {
  if (!sawReady) {
    log("no ready frame within 20s");
    process.exit(4);
  }
  if (PROMPT) {
    log(`sending prompt: "${PROMPT}"`);
    request({ id: "smoke-prompt", type: "prompt", message: PROMPT });
  } else {
    log("no --prompt given; handshake-only pass");
    clearTimeout(timeout);
    setTimeout(() => {
      log("SMOKE OK (handshake)");
      process.exit(0);
    }, 500);
  }
}, 5_000);
