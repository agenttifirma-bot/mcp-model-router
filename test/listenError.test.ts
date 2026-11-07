import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

describe("HTTP-palvelimen käynnistysvirhe", () => {
  it("varattu portti: prosessi päättyy koodilla 1 eikä onnistumisviestiä kirjata", async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const port = (blocker.address() as AddressInfo).port;
    try {
      const res = await new Promise<ReturnType<typeof spawnSync>>((resolve) => {
        // spawnSync estäisi tapahtumasilmukan, mutta blocker vain pitää porttia auki: kelpaa.
        resolve(
          spawnSync("node_modules/.bin/tsx", ["test/fixtures/listen-varattu.ts", String(port)], {
            encoding: "utf8",
            timeout: 20000,
          }),
        );
      });
      const out = `${res.stdout}${res.stderr}`;
      expect(res.status).toBe(1);
      expect(out).not.toMatch(/kuuntelee osoitteessa/);
      expect(out).toMatch(/käynnistys epäonnistui \(EADDRINUSE\)/);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  }, 30000);
});
