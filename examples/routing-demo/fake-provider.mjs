// A tiny fake OpenAI-compatible provider for the routing demo.
// It answers POST /chat/completions with a canned reply that names the model
// it was asked for, and GET /models with a fixed model list. Any model whose
// id contains "unavailable" gets HTTP 503, which lets the demo show the
// router's fallback. Nothing leaves the machine: it listens on 127.0.0.1 only.
import { createServer } from "node:http";

export const FAKE_MODELS = ["demo/fast-cheap", "demo/coder", "demo/writer"];

/**
 * Starts the fake provider on 127.0.0.1 and a free port.
 * Returns { baseUrl, requests, close }. `requests` records the model id of
 * every chat call, in order, so callers can see what the router really sent.
 */
export async function startFakeProvider() {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && req.url === "/models") {
        return send(200, { object: "list", data: FAKE_MODELS.map((id) => ({ id, object: "model" })) });
      }
      if (req.method === "POST" && req.url === "/chat/completions") {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(400, { error: { message: "invalid JSON" } });
        }
        const model = String(body.model ?? "");
        requests.push(model);
        if (model.includes("unavailable")) {
          return send(503, { error: { message: "model temporarily unavailable (fake)" } });
        }
        const user = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
        const prompt = String(user?.content ?? "");
        const text = `[${model}] fake answer to: ${prompt.slice(0, 60)}`;
        const promptTokens = Math.ceil(prompt.length / 4);
        const completionTokens = Math.ceil(text.length / 4);
        return send(200, {
          id: `fake-${requests.length}`,
          object: "chat.completion",
          model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        });
      }
      send(404, { error: { message: "not found" } });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
