import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEnvPlaceholders, loadConfig, ConfigNotFoundError } from "../src/config/load.js";

describe("resolveEnvPlaceholders", () => {
  it("korvaa ${NIMI}-viittauksen ympäristömuuttujalla", () => {
    const result = resolveEnvPlaceholders("arvo: ${FOO}", { FOO: "bar" });
    expect(result).toBe("arvo: bar");
  });

  it("käyttää oletusarvoa kun muuttujaa ei ole asetettu", () => {
    const result = resolveEnvPlaceholders("arvo: ${FOO:-oletus}", {});
    expect(result).toBe("arvo: oletus");
  });

  it("tukee sisäkkäisiä oletusarvoja", () => {
    const result = resolveEnvPlaceholders("arvo: ${FOO:-${BAR:-perus}}", {});
    expect(result).toBe("arvo: perus");
  });

  it("ei muuta tekstiä jos placeholderia ei ole", () => {
    const result = resolveEnvPlaceholders("ei placeholderia", {});
    expect(result).toBe("ei placeholderia");
  });

  it("lisää muuttujan arvon kirjaimellisena (salasanassa voi olla ${...})", () => {
    const result = resolveEnvPlaceholders("apiKey: ${PW}", { PW: "p${HOME}x", HOME: "/root" });
    expect(result).toBe("apiKey: p${HOME}x");
  });

  it("ei jumiudu, kun muuttujan arvo viittaa muuttujaan itseensä", () => {
    const result = resolveEnvPlaceholders("${X}", { X: "a${X}" });
    expect(result).toBe("a${X}");
  });

  it("oletusarvon sisäinen viittaus käyttää asetettua muuttujaa", () => {
    expect(resolveEnvPlaceholders("${FOO:-${BAR:-perus}}", { BAR: "bar" })).toBe("bar");
    expect(resolveEnvPlaceholders("${FOO:-${BAR}}/v1", { FOO: "foo", BAR: "bar" })).toBe("foo/v1");
  });

  it("tyhjä muuttuja käyttää oletusta, puuttuva ilman oletusta on tyhjä", () => {
    expect(resolveEnvPlaceholders("[${FOO:-x}][${BAR}]", { FOO: "" })).toBe("[x][]");
  });

  it("jättää sulkemattoman tai virheellisen viittauksen ennalleen", () => {
    expect(resolveEnvPlaceholders("${FOO:-abc", { FOO: "f" })).toBe("${FOO:-abc");
    expect(resolveEnvPlaceholders("${1X} ja $FOO", { FOO: "f" })).toBe("${1X} ja $FOO");
  });
});

describe("loadConfig", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function writeConfig(yaml: string): string {
    const dir = mkdtempSync(join(tmpdir(), "mcp-model-router-test-"));
    dirs.push(dir);
    const path = join(dir, "config.yaml");
    writeFileSync(path, yaml, "utf8");
    return path;
  }

  it("lataa ja validoi kelvollisen asetustiedoston", () => {
    const path = writeConfig(`
provider:
  baseUrl: http://localhost:4000
tasks:
  general:
    model: some-model
usage:
  baseUrl: http://localhost:4000
`);
    const config = loadConfig({ configPath: path, env: {} });
    expect(config.provider.baseUrl).toBe("http://localhost:4000");
    expect(config.tasks.general.model).toBe("some-model");
    expect(config.usage.provider).toBe("litellm");
  });

  it("heittää selkeän virheen puuttuvasta tiedostosta", () => {
    expect(() => loadConfig({ configPath: "/ei/olemassa/config.yaml", env: {} })).toThrow(/Config file not found at '\/ei\/olemassa\/config.yaml'.*CONFIG_PATH/);
  });

  it("puuttuvan tiedoston virhe on ConfigNotFoundError ja kertoo korjauksen", () => {
    let err: unknown;
    try {
      loadConfig({ configPath: "/ei/olemassa/config.yaml", env: {} });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigNotFoundError);
    expect((err as Error).message).toContain("config.example.yaml");
  });

  it("heittää selkeän virheen puuttuvista pakollisista kentistä", () => {
    const path = writeConfig(`
provider:
  baseUrl: http://localhost:4000
tasks: {}
usage:
  baseUrl: http://localhost:4000
`);
    expect(() => loadConfig({ configPath: path, env: {} })).toThrow(/tasks/);
  });

  it("lukee tehtävätyyppikohtaisen timeoutMs:n, joka on oletuksena määrittelemätön", () => {
    const path = writeConfig(`
provider:
  baseUrl: http://localhost:4000
tasks:
  general:
    model: some-model
  orchestration:
    model: some-other-model
    timeoutMs: 180000
usage:
  baseUrl: http://localhost:4000
`);
    const config = loadConfig({ configPath: path, env: {} });
    expect(config.tasks.general.timeoutMs).toBeUndefined();
    expect(config.tasks.orchestration.timeoutMs).toBe(180_000);
  });

  it.each([
    ["provider.timeoutMs", "provider:\n  baseUrl: http://localhost:4000\n  timeoutMs: 2147483648\ntasks:\n  general:\n    model: m\n"],
    ["tasks.<tyyppi>.timeoutMs", "provider:\n  baseUrl: http://localhost:4000\ntasks:\n  general:\n    model: m\n    timeoutMs: 3000000000\n"],
  ])("hylkää %s:n, joka ylittää setTimeoutin rajan (2^31 - 1 ms)", (_kentta, yaml) => {
    const path = writeConfig(`${yaml}usage:\n  baseUrl: http://localhost:4000\n`);
    expect(() => loadConfig({ configPath: path, env: {} })).toThrow(/timeoutMs/);
  });

  it("hyväksyy timeoutMs:n täsmälleen rajalla 2147483647", () => {
    const path = writeConfig(`
provider:
  baseUrl: http://localhost:4000
  timeoutMs: 2147483647
tasks:
  general:
    model: m
    timeoutMs: 2147483647
usage:
  baseUrl: http://localhost:4000
`);
    const config = loadConfig({ configPath: path, env: {} });
    expect(config.provider.timeoutMs).toBe(2_147_483_647);
    expect(config.tasks.general.timeoutMs).toBe(2_147_483_647);
  });

  it("eval.concurrency:n oletusarvo on 4, kun sitä ei ole asetettu", () => {
    const path = writeConfig(`
provider:
  baseUrl: http://localhost:4000
tasks:
  general:
    model: some-model
usage:
  baseUrl: http://localhost:4000
`);
    const config = loadConfig({ configPath: path, env: {} });
    expect(config.eval.concurrency).toBe(4);
  });

  it("hylkää eval.concurrency:n arvon alle 1", () => {
    const path = writeConfig(`
provider:
  baseUrl: http://localhost:4000
tasks:
  general:
    model: some-model
usage:
  baseUrl: http://localhost:4000
eval:
  concurrency: 0
`);
    expect(() => loadConfig({ configPath: path, env: {} })).toThrow(/concurrency/);
  });

  it("resolvoi ympäristömuuttujat ennen validointia", () => {
    const path = writeConfig(`
provider:
  baseUrl: \${LLM_BASE_URL}
tasks:
  general:
    model: some-model
usage:
  baseUrl: \${LLM_BASE_URL}
`);
    const config = loadConfig({ configPath: path, env: { LLM_BASE_URL: "http://litellm.local:4000" } });
    expect(config.provider.baseUrl).toBe("http://litellm.local:4000");
  });
});
