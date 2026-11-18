// Apuskripti: käynnistää HTTP-siirron portissa, jonka testi on varannut.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startHttpTransport } from "../../src/transport/http.js";

startHttpTransport(() => new McpServer({ name: "t", version: "0" }), {
  host: "127.0.0.1",
  port: Number(process.argv[2]),
  authToken: "t".repeat(16) + "k".repeat(16) + "-secret-for-tests",
});
