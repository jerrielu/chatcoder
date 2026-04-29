import { z } from "zod";
export declare const DaemonMessage: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodString;
    /** true = daemon should resume last CLI session; false = start fresh. */
    resumeLastSession: z.ZodDefault<z.ZodBoolean>;
    /** Optional Codex reasoning effort override for OPENAI profiles. */
    codexReasoningEffort: z.ZodOptional<z.ZodEnum<["low", "medium", "high", "xhigh"]>>;
    createdAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    content: string;
    resumeLastSession: boolean;
    createdAt: number;
    codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
}, {
    id: string;
    content: string;
    createdAt: number;
    resumeLastSession?: boolean | undefined;
    codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
}>;
export type DaemonMessage = z.infer<typeof DaemonMessage>;
/** Shape of one session returned by GET /v1/poll. */
export declare const PollSession: z.ZodObject<{
    sessionId: z.ZodString;
    profileName: z.ZodString;
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        content: z.ZodString;
        /** true = daemon should resume last CLI session; false = start fresh. */
        resumeLastSession: z.ZodDefault<z.ZodBoolean>;
        /** Optional Codex reasoning effort override for OPENAI profiles. */
        codexReasoningEffort: z.ZodOptional<z.ZodEnum<["low", "medium", "high", "xhigh"]>>;
        createdAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        content: string;
        resumeLastSession: boolean;
        createdAt: number;
        codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
    }, {
        id: string;
        content: string;
        createdAt: number;
        resumeLastSession?: boolean | undefined;
        codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    profileName: string;
    messages: {
        id: string;
        content: string;
        resumeLastSession: boolean;
        createdAt: number;
        codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
    }[];
}, {
    sessionId: string;
    profileName: string;
    messages: {
        id: string;
        content: string;
        createdAt: number;
        resumeLastSession?: boolean | undefined;
        codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
    }[];
}>;
export type PollSession = z.infer<typeof PollSession>;
export declare const PollResponse: z.ZodObject<{
    reset: z.ZodBoolean;
    sessions: z.ZodArray<z.ZodObject<{
        sessionId: z.ZodString;
        profileName: z.ZodString;
        messages: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            content: z.ZodString;
            /** true = daemon should resume last CLI session; false = start fresh. */
            resumeLastSession: z.ZodDefault<z.ZodBoolean>;
            /** Optional Codex reasoning effort override for OPENAI profiles. */
            codexReasoningEffort: z.ZodOptional<z.ZodEnum<["low", "medium", "high", "xhigh"]>>;
            createdAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            id: string;
            content: string;
            resumeLastSession: boolean;
            createdAt: number;
            codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
        }, {
            id: string;
            content: string;
            createdAt: number;
            resumeLastSession?: boolean | undefined;
            codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        profileName: string;
        messages: {
            id: string;
            content: string;
            resumeLastSession: boolean;
            createdAt: number;
            codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
        }[];
    }, {
        sessionId: string;
        profileName: string;
        messages: {
            id: string;
            content: string;
            createdAt: number;
            resumeLastSession?: boolean | undefined;
            codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
        }[];
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    reset: boolean;
    sessions: {
        sessionId: string;
        profileName: string;
        messages: {
            id: string;
            content: string;
            resumeLastSession: boolean;
            createdAt: number;
            codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
        }[];
    }[];
}, {
    reset: boolean;
    sessions: {
        sessionId: string;
        profileName: string;
        messages: {
            id: string;
            content: string;
            createdAt: number;
            resumeLastSession?: boolean | undefined;
            codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | undefined;
        }[];
    }[];
}>;
export type PollResponse = z.infer<typeof PollResponse>;
export declare const PostResponseBody: z.ZodObject<{
    sessionId: z.ZodString;
    content: z.ZodString;
    /** false = progress update only; true = send final result to client. */
    final: z.ZodDefault<z.ZodBoolean>;
    /** Optional echo of originating instruction id for tracing. */
    replyTo: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    content: string;
    sessionId: string;
    final: boolean;
    replyTo?: string | undefined;
}, {
    content: string;
    sessionId: string;
    final?: boolean | undefined;
    replyTo?: string | undefined;
}>;
export type PostResponseBody = z.infer<typeof PostResponseBody>;
export declare const HeartbeatBody: z.ZodObject<{
    /** Semver of the running daemon, for future compatibility gates. */
    version: z.ZodOptional<z.ZodString>;
    /** Free-form status blurb. */
    note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version?: string | undefined;
    note?: string | undefined;
}, {
    version?: string | undefined;
    note?: string | undefined;
}>;
export type HeartbeatBody = z.infer<typeof HeartbeatBody>;
export declare const HeartbeatResponse: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    reset: z.ZodBoolean;
    serverTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    reset: boolean;
    ok: true;
    serverTime: number;
}, {
    reset: boolean;
    ok: true;
    serverTime: number;
}>;
export type HeartbeatResponse = z.infer<typeof HeartbeatResponse>;
export declare const RegisteredProfile: z.ZodObject<{
    name: z.ZodString;
    tool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
    metadata: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    metadata?: string | undefined;
}, {
    name: string;
    tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    metadata?: string | undefined;
}>;
export type RegisteredProfile = z.infer<typeof RegisteredProfile>;
export declare const DaemonRegisterBody: z.ZodObject<{
    profiles: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        tool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
        metadata: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
        metadata?: string | undefined;
    }, {
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
        metadata?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    profiles: {
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
        metadata?: string | undefined;
    }[];
}, {
    profiles: {
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
        metadata?: string | undefined;
    }[];
}>;
export type DaemonRegisterBody = z.infer<typeof DaemonRegisterBody>;
export declare const DaemonRegisterResponse: z.ZodObject<{
    apiKeyId: z.ZodString;
    profiles: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        tool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }, {
        id: string;
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    profiles: {
        id: string;
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }[];
    apiKeyId: string;
}, {
    profiles: {
        id: string;
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }[];
    apiKeyId: string;
}>;
export type DaemonRegisterResponse = z.infer<typeof DaemonRegisterResponse>;
//# sourceMappingURL=protocol.d.ts.map