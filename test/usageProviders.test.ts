import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { fetchUsage } from "../src/usage/usageProviders.js";

describe("fetchUsage", () => {
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

  it("lukee LiteLLM:n /user/info-vastauksen", async () => {
    const pool = mockAgent.get("http://litellm.local:4000");
    pool
      .intercept({ path: "/user/info", method: "GET" })
      .reply(200, { user_info: { spend: 12.5, max_budget: 100 } });

    const snapshot = await fetchUsage({ provider: "litellm", baseUrl: "http://litellm.local:4000", apiKey: "" });

    expect(snapshot.provider).toBe("litellm");
    expect(snapshot.summary.spendUsd).toBe(12.5);
    expect(snapshot.summary.budgetUsd).toBe(100);
    expect(snapshot.summary.remainingUsd).toBe(87.5);
  });

  it("rajaa LiteLLM:n raw-kentan sallittuihin kenttiin (ei avainten metatietoja)", async () => {
    const pool = mockAgent.get("http://litellm.local:4000");
    pool.intercept({ path: "/user/info", method: "GET" }).reply(200, {
      user_id: "u-secret",
      user_info: { spend: 1, max_budget: 5, user_email: "a@b.c", metadata: { x: 1 } },
      keys: [{ token: "hash123", key_name: "sk-...abcd", key_alias: "alias", team_id: "t1" }],
      teams: [{ team_id: "t1" }],
    });

    const snapshot = await fetchUsage({ provider: "litellm", baseUrl: "http://litellm.local:4000", apiKey: "" });
    const raw = JSON.stringify(snapshot.raw);

    expect(snapshot.raw).toEqual({ user_info: { spend: 1, max_budget: 5 } });
    for (const vuoto of ["hash123", "sk-...abcd", "alias", "u-secret", "a@b.c", "t1"]) {
      expect(raw).not.toContain(vuoto);
    }
    expect(snapshot.summary.remainingUsd).toBe(4);
  });

  it("poimii LiteLLM:n kulutuksen ylatasolta (vanhempi vastausmuoto) raw-kenttaan", async () => {
    const pool = mockAgent.get("http://litellm.local:4000");
    pool.intercept({ path: "/user/info", method: "GET" }).reply(200, {
      spend: 2,
      max_budget: 10,
      keys: [{ token: "hash123" }],
    });

    const snapshot = await fetchUsage({ provider: "litellm", baseUrl: "http://litellm.local:4000", apiKey: "" });

    expect(snapshot.raw).toEqual({ user_info: { spend: 2, max_budget: 10 } });
    expect(JSON.stringify(snapshot.raw)).not.toContain("hash123");
    expect(snapshot.summary.remainingUsd).toBe(8);
  });

  it("taydentaa puuttuvan user_info-kulutuksen ylatason kentilla", async () => {
    const pool = mockAgent.get("http://litellm.local:4000");
    pool.intercept({ path: "/user/info", method: "GET" }).reply(200, {
      spend: 3,
      user_info: { max_budget: 9, user_email: "a@b.c" },
    });

    const snapshot = await fetchUsage({ provider: "litellm", baseUrl: "http://litellm.local:4000", apiKey: "" });

    expect(snapshot.raw).toEqual({ user_info: { spend: 3, max_budget: 9 } });
    expect(snapshot.summary.spendUsd).toBe(3);
  });

  it("lukee OpenRouterin /credits-vastauksen", async () => {
    const pool = mockAgent.get("https://openrouter.ai");
    pool
      .intercept({ path: "/credits", method: "GET" })
      .reply(200, { data: { total_credits: 50, total_usage: 10 } });

    const snapshot = await fetchUsage({ provider: "openrouter", baseUrl: "https://openrouter.ai", apiKey: "" });

    expect(snapshot.provider).toBe("openrouter");
    expect(snapshot.summary.spendUsd).toBe(10);
    expect(snapshot.summary.budgetUsd).toBe(50);
    expect(snapshot.summary.remainingUsd).toBe(40);
  });

  it("heittää virheen kun rajapinta vastaa virheellä", async () => {
    const pool = mockAgent.get("http://litellm.local:4000");
    pool.intercept({ path: "/user/info", method: "GET" }).reply(401, "unauthorized");

    await expect(
      fetchUsage({ provider: "litellm", baseUrl: "http://litellm.local:4000", apiKey: "" }),
    ).rejects.toThrow(/401/);
  });
  it("aikakatkaisee roikkuvan kulutusrajapinnan (katselmointi 28.10., löydös 5)", async () => {
    const pool = mockAgent.get("http://litellm.local:4000");
    pool.intercept({ path: "/user/info", method: "GET" }).reply(200, { user_info: { spend: 1 } }).delay(2_000);

    const alku = Date.now();
    await expect(
      fetchUsage({ provider: "litellm", baseUrl: "http://litellm.local:4000", apiKey: "", timeoutMs: 100 }),
    ).rejects.toThrow(/aikakatkaistiin \(100 ms\)/);
    expect(Date.now() - alku).toBeLessThan(1_500);
  });

  it("HTTP-virhe näkyy edelleen tilakoodina", async () => {
    const pool = mockAgent.get("https://openrouter.ai");
    pool.intercept({ path: "/credits", method: "GET" }).reply(503, "huolto");
    await expect(fetchUsage({ provider: "openrouter", baseUrl: "https://openrouter.ai", apiKey: "" })).rejects.toThrow(/503/);
  });
});
