import type { FastifyInstance } from "fastify";
import { ApiError, ERROR_CODES } from "@chatcoder/shared";
import { ZodError } from "zod";

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      reply.code(err.httpStatus).send(err.toEnvelope());
      return;
    }
    if (err instanceof ZodError) {
      reply.code(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        }
      });
      return;
    }
    // Fastify validation errors surface as `.validation`
    if ((err as { validation?: unknown }).validation) {
      reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }
      });
      return;
    }
    req.log.error({ err }, "unhandled error");
    reply.code(500).send({
      error: { code: ERROR_CODES.INTERNAL, message: "Internal error" }
    });
  });
}
