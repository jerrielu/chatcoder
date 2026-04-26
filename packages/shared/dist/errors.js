export const ERROR_CODES = {
    UNAUTHORIZED: "UNAUTHORIZED",
    SESSION_REVOKED: "SESSION_REVOKED",
    RATE_LIMITED: "RATE_LIMITED",
    QUEUE_FULL: "QUEUE_FULL",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    INTERNAL: "INTERNAL"
};
export class ApiError extends Error {
    code;
    httpStatus;
    constructor(code, message, httpStatus) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.name = "ApiError";
    }
    toEnvelope() {
        return { error: { code: this.code, message: this.message } };
    }
    static unauthorized(msg = "Invalid or missing API key") {
        return new ApiError(ERROR_CODES.UNAUTHORIZED, msg, 401);
    }
    static sessionRevoked(msg = "Session has been revoked") {
        return new ApiError(ERROR_CODES.SESSION_REVOKED, msg, 410);
    }
    static rateLimited(msg = "Too fast — 1 instruction per second") {
        return new ApiError(ERROR_CODES.RATE_LIMITED, msg, 429);
    }
    static queueFull(msg = "Queue is full; please drain it first") {
        return new ApiError(ERROR_CODES.QUEUE_FULL, msg, 409);
    }
    static validation(msg) {
        return new ApiError(ERROR_CODES.VALIDATION_ERROR, msg, 400);
    }
    static internal(msg = "Internal error") {
        return new ApiError(ERROR_CODES.INTERNAL, msg, 500);
    }
}
//# sourceMappingURL=errors.js.map