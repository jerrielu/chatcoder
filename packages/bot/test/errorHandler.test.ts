import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { ZodError, z } from "zod";
import { installErrorHandler } from "../src/api/errorHandler.js";
import { ApiError } from "@chatcoder/shared";

describe("installErrorHandler", () => {
  it("serializes ApiError with its http status + envelope", async () => {
    const app = Fastify();
    installErrorHandler(app);
    app.get("/boom", async () => {
      throw ApiError.queueFull();
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("QUEUE_FULL");
    await app.close();
  });

  it("serializes ZodError as 400 VALIDATION_ERROR", async () => {
    const app = Fastify();
    installErrorHandler(app);
    app.get("/z", async () => {
      throw new ZodError(
        z.object({ a: z.string() }).safeParse({ a: 1 } as unknown).error!.issues
      );
    });
    const r = await app.inject({ method: "GET", url: "/z" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("falls through to 500 INTERNAL for unknown errors", async () => {
    const app = Fastify({ logger: false });
    installErrorHandler(app);
    app.get("/surprise", async () => {
      throw new Error("kaboom");
    });
    const r = await app.inject({ method: "GET", url: "/surprise" });
    expect(r.statusCode).toBe(500);
    expect(r.json().error.code).toBe("INTERNAL");
    await app.close();
  });

  it("returns 400 for fastify-validation errors (err.validation set)", async () => {
    const app = Fastify();
    installErrorHandler(app);
    app.post(
      "/v",
      {
        schema: {
          body: {
            type: "object",
            required: ["x"],
            properties: { x: { type: "string" } }
          }
        }
      },
      async () => ({ ok: true })
    );
    const r = await app.inject({ method: "POST", url: "/v", payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});
