import { describe, it, expect } from "vitest";
import { deriveLocalApiUrl } from "../src/apiUrl.js";

describe("deriveLocalApiUrl", () => {
  it("uses the explicit host when bindable", () => {
    expect(deriveLocalApiUrl("127.0.0.1", 8080)).toBe("http://127.0.0.1:8080");
    expect(deriveLocalApiUrl("bot.example.com", 443)).toBe("http://bot.example.com:443");
  });

  it("rewrites 0.0.0.0 to localhost so the URL is actually reachable", () => {
    expect(deriveLocalApiUrl("0.0.0.0", 8080)).toBe("http://localhost:8080");
  });

  it("rewrites :: (IPv6 wildcard) to localhost", () => {
    expect(deriveLocalApiUrl("::", 8080)).toBe("http://localhost:8080");
  });
});
