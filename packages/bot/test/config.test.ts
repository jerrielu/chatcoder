import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect } from "vitest";
import { loadConfigFromEnv, parseConfig } from "../src/config.js";

const defaultDbUrl = `sqlite:${path.join(os.homedir(), ".chatcoder", "chatcoder.db")}`;

describe("bot config", () => {
  it("loads required fields from env", () => {
    const cfg = loadConfigFromEnv({
      TELEGRAM_BOT_TOKEN: "t"
    } as NodeJS.ProcessEnv);
    expect(cfg.listenPort).toBe(8080);
    expect(cfg.listenHost).toBe("0.0.0.0");
    expect(cfg.heartbeatStaleMs).toBe(60_000);
    expect(cfg.databaseUrl).toBe(defaultDbUrl);
  });

  it("respects overrides", () => {
    const cfg = loadConfigFromEnv({
      TELEGRAM_BOT_TOKEN: "t",
      DATABASE_URL: "sqlite::memory:",
      BOT_LISTEN_PORT: "1234",
      BOT_LOG_LEVEL: "debug",
      BOT_PUBLIC_URL: "https://example.com",
      BOT_HEARTBEAT_STALE_MS: "120000"
    } as NodeJS.ProcessEnv);
    expect(cfg.listenPort).toBe(1234);
    expect(cfg.logLevel).toBe("debug");
    expect(cfg.publicUrl).toBe("https://example.com");
    expect(cfg.heartbeatStaleMs).toBe(120_000);
    expect(cfg.databaseUrl).toBe("sqlite::memory:");
  });

  it("throws when required token is missing", () => {
    expect(() => loadConfigFromEnv({ DATABASE_URL: "sqlite::memory:" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("parseConfig rejects invalid port", () => {
    expect(() =>
      parseConfig({
        telegramBotToken: "t",
        databaseUrl: "sqlite::memory:",
        listenPort: 0
      })
    ).toThrow();
  });
});
