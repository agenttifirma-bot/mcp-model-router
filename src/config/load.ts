import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { load as parseYaml } from "js-yaml";
import { AppConfigSchema, type AppConfig } from "./schema.js";

/**
 * Korvaa merkkijonoissa ${NIMI} ja ${NIMI:-oletus} -viittaukset ympäristömuuttujilla.
 * Oletusarvo voi itse sisältää uuden ${...}-viittauksen (sisäkkäiset oletukset).
 *
 * Ympäristömuuttujan arvo lisätään kirjaimellisena: sen sisältöä ei enää jäsennetä.
 * Aiempi toteutus ajoi korvausta silmukassa, jolloin esim. salasana `p${HOME}x`
 * muuttui hiljaa ja arvo `a${X}` muuttujassa X jumitti latauksen ikuiseen silmukkaan.
 * Tunnistamaton tai sulkematon `${` jätetään sellaisenaan.
 */
export function resolveEnvPlaceholders(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return expand(input, 0, env, false).text;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Jäsentää kohdasta `start` alkaen. Kun `inDefault` on tosi, pysähtyy oletusarvon
 * sulkevaan `}`-merkkiin ja palauttaa sen indeksin `end`-kentässä (-1, jos sulkevaa ei löydy).
 */
function expand(input: string, start: number, env: NodeJS.ProcessEnv, inDefault: boolean): { text: string; end: number } {
  let out = "";
  let i = start;
  while (i < input.length) {
    const ch = input[i];
    if (inDefault && ch === "}") return { text: out, end: i };
    if (ch === "$" && input[i + 1] === "{") {
      const name = NAME.exec(input.slice(i + 2))?.[0];
      if (name) {
        const after = i + 2 + name.length;
        if (input[after] === "}") {
          out += lookup(env, name) ?? "";
          i = after + 1;
          continue;
        }
        if (input.startsWith(":-", after)) {
          const inner = expand(input, after + 2, env, true);
          if (inner.end !== -1) {
            out += lookup(env, name) ?? inner.text;
            i = inner.end + 1;
            continue;
          }
        }
      }
    }
    out += ch;
    i += 1;
  }
  return { text: out, end: inDefault ? -1 : i };
}

function lookup(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value !== undefined && value !== "" ? value : undefined;
}

function resolveDeep<T>(value: T, env: NodeJS.ProcessEnv): T {
  if (typeof value === "string") {
    return resolveEnvPlaceholders(value, env) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveDeep(item, env)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveDeep(val, env);
    }
    return result as unknown as T;
  }
  return value;
}

/** Heitetään, kun asetustiedostoa ei löydy. Viesti on valmis näytettäväksi ilman pinojälkeä. */
export class ConfigNotFoundError extends Error {
  constructor(configPath: string) {
    super(
      `Config file not found at '${resolve(configPath)}'. ` +
        `Copy config.example.yaml to config.yaml and edit it, or set CONFIG_PATH to point to your own file. ` +
        `With the npm package: cp node_modules/mcp-model-router/config.example.yaml config.yaml`,
    );
    this.name = "ConfigNotFoundError";
  }
}

export interface LoadConfigOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const configPath = options.configPath ?? process.env.CONFIG_PATH ?? "config.yaml";
  const env = options.env ?? process.env;

  if (!existsSync(configPath)) {
    throw new ConfigNotFoundError(configPath);
  }

  const raw = readFileSync(configPath, "utf8");
  const parsed = parseYaml(raw);
  const resolved = resolveDeep(parsed, env);

  const result = AppConfigSchema.safeParse(resolved);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(juuri)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Asetustiedosto '${configPath}' ei kelpaa:\n${issues}`);
  }
  return result.data;
}
