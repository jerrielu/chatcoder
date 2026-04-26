export declare const ERROR_CODES: {
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly SESSION_REVOKED: "SESSION_REVOKED";
    readonly RATE_LIMITED: "RATE_LIMITED";
    readonly QUEUE_FULL: "QUEUE_FULL";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly INTERNAL: "INTERNAL";
};
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export interface ApiErrorEnvelope {
    error: {
        code: ErrorCode;
        message: string;
    };
}
export declare class ApiError extends Error {
    readonly code: ErrorCode;
    readonly httpStatus: number;
    constructor(code: ErrorCode, message: string, httpStatus: number);
    toEnvelope(): ApiErrorEnvelope;
    static unauthorized(msg?: string): ApiError;
    static sessionRevoked(msg?: string): ApiError;
    static rateLimited(msg?: string): ApiError;
    static queueFull(msg?: string): ApiError;
    static validation(msg: string): ApiError;
    static internal(msg?: string): ApiError;
}
//# sourceMappingURL=errors.d.ts.map