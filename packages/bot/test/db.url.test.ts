import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb } from "../src/db/index.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.shift()!();
});

describe("openDb url parsing", () => {
  it("accepts sqlite::memory:", async () => {
    const h = await openDb("sqlite::memory:");
    cleanup.push(() => h.close());
    expect(h.db).toBeDefined();
  });

  it("accepts sqlite:// in-memory form", async () => {
    const h = await openDb("sqlite://:memory:");
    cleanup.push(() => h.close());
    expect(h.db).toBeDefined();
  });

  it("accepts sqlite:/// URL-style absolute path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sqlite-url-"));
    const file = path.join(dir, "chatcoder.db");
    const h = await openDb(`sqlite://${file}`);
    cleanup.push(async () => {
      await h.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    expect(fs.existsSync(file)).toBe(true);
  });

  it("accepts sqlite:relative-path form", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sqlite-rel-"));
    const file = path.join(dir, "cc.db");
    const h = await openDb(`sqlite:${file}`);
    cleanup.push(async () => {
      await h.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    expect(fs.existsSync(file)).toBe(true);
  });

  it("rejects unsupported urls", async () => {
    await expect(openDb("mysql://nope")).rejects.toThrow(/Unsupported/);
  });
});
