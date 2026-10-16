import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { routeAndComplete } from "../src/router/routeAndComplete.js";
import { Db } from "../src/lib/db.js";
import type { AppConfig } from "../src/config/schema.js";

function baseConfig(): AppConfig {
  return {
    server: { name: "test", version: "0.0.0" },
    provider: { baseUrl: "http://litellm.local:4000", apiKey: "", timeoutMs: 5000, kind: "litellm" },
    tasks: {
      general: { model: "primary-model", fallbackModel: "fallback-model" },
    },
    usage: { provider: "litellm", baseUrl: "http://litellm.local:4000", apiKey: "" },
    eval: { judge: { enabled: false }, pricing: {}, concurrency: 4 },
    database: { path: ":memory:" },
  };
}

type LogRow = {
  model_requested: string;
  model_used: string;
  used_fallback: number;
  status: string;
  error_message: string | null;
};

describe("routeAndComplete: varamallin epäonnistuminen ja aikakatkaisut", () => {
  let mockAgent: MockAgent;
  const originalDispatcher = getGlobalDispatcher();

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
  });

  it("kun sekä päämalli että varamalli epäonnistuvat, virhe kertoo molemmat", async () => {
    const pool = mockAgent.get("http://litellm.local:4000");
    pool.intercept({ path: "/chat/completions", method: "POST" }).reply(500, "paamalli-rikki");
    pool.intercept({ path: "/chat/completions", method: "POST" }).reply(503, "varamalli-rikki");

    const err = await routeAndComplete(baseConfig(), { taskType: "general", prompt: "moi" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/503/); // varamallin virhe
    expect(msg).toMatch(/500/); // päämallin virhe ei saa hävitä
  });

  it("kun sekä päämalli että varamalli epäonnistuvat, kutsuloki saa error-rivin", async () => {
    const pool = mockAgent.get("http://litellm.local:4000");
    pool.intercept({ path: "/chat/completions", method: "POST" }).reply(500, "paamalli-rikki");
    pool.intercept({ path: "/chat/completions", method: "POST" }).reply(503, "varamalli-rikki");

    const db = new Db(":memory:");
    await expect(routeAndComplete(baseConfig(), { taskType: "general", prompt: "moi" }, db)).rejects.toThrow();

    const rows = db.listRecentCallLogs(10) as LogRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("error");
    expect(rows[0].used_fallback).toBe(1);
    expect(rows[0].model_requested).toBe("primary-model");
    expect(rows[0].model_used).toBe("fallback-model");
    expect(rows[0].error_message).toMatch(/500/);
    expect(rows[0].error_message).toMatch(/503/);
    db.close();
  });

  it("päämallin aikakatkaisu laukaisee varamallin ja primaryError kertoo aikakatkaisusta", async () => {
    const config = baseConfig();
    config.tasks.general = { model: "primary-model", fallbackModel: "fallback-model", timeoutMs: 30 };

    const pool = mockAgent.get("http://litellm.local:4000");
    pool
      .intercept({ path: "/chat/completions", method: "POST" })
      .reply(200, { model: "primary-model", choices: [{ message: { content: "liian myöhään" } }] })
      .delay(300);
    pool
      .intercept({ path: "/chat/completions", method: "POST" })
      .reply(200, { model: "fallback-model", choices: [{ message: { content: "varavastaus" } }] });

    const result = await routeAndComplete(config, { taskType: "general", prompt: "moi" });

    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe("varavastaus");
    expect(result.primaryError).toMatch(/aikakatkaistiin \(30 ms\)/);
  });

  it("varamalli saa oman aikakatkaisunsa: hidas varamalli epäonnistuu aikakatkaisuun", async () => {
    const config = baseConfig();
    config.tasks.general = { model: "primary-model", fallbackModel: "fallback-model", timeoutMs: 30 };

    const pool = mockAgent.get("http://litellm.local:4000");
    pool.intercept({ path: "/chat/completions", method: "POST" }).reply(500, "paamalli-rikki");
    pool
      .intercept({ path: "/chat/completions", method: "POST" })
      .reply(200, { model: "fallback-model", choices: [{ message: { content: "liian myöhään" } }] })
      .delay(300);

    const err = await routeAndComplete(config, { taskType: "general", prompt: "moi" }).catch((e: unknown) => e);

    expect((err as Error).message).toMatch(/aikakatkaistiin \(30 ms\)/);
  });
});
