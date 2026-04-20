export const ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  SESSION_REVOKED: "SESSION_REVOKED",
  RATE_LIMITED: "RATE_LIMITED",
  QUEUE_FULL: "QUEUE_FULL",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INTERNAL: "INTERNAL"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorEnvelope {
  error: { code: ErrorCode; message: string };
}

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "ApiError";
  }

  toEnvelope(): ApiErrorEnvelope {
    return { error: { code: this.code, message: this.message } };
  }

  static unauthorized(msg = "Invalid or missing API key"): ApiError {
    return new ApiError(ERROR_CODES.UNAUTHORIZED, msg, 401);
  }
  static sessionRevoked(msg = "Session has been revoked"): ApiError {
    return new ApiError(ERROR_CODES.SESSION_REVOKED, msg, 410);
  }
  static rateLimited(msg = "Too fast — 1 /code per second"): ApiError {
    return new ApiError(ERROR_CODES.RATE_LIMITED, msg, 429);
  }
  static queueFull(msg = "Queue is full; please drain it first"): ApiError {
    return new ApiError(ERROR_CODES.QUEUE_FULL, msg, 409);
  }
  static validation(msg: string): ApiError {
    return new ApiError(ERROR_CODES.VALIDATION_ERROR, msg, 400);
  }
  static internal(msg = "Internal error"): ApiError {
    return new ApiError(ERROR_CODES.INTERNAL, msg, 500);
  }
}
