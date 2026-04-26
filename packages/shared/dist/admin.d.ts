import { z } from "zod";
export declare const AdminApiKey: z.ZodObject<{
    id: z.ZodString;
    apiKeyPrefix: z.ZodString;
    status: z.ZodEnum<["active", "revoked"]>;
    createdAt: z.ZodNumber;
    revokedAt: z.ZodNullable<z.ZodNumber>;
    lastHeartbeat: z.ZodNullable<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    id: string;
    apiKeyPrefix: string;
    status: "active" | "revoked";
    createdAt: number;
    revokedAt: number | null;
    lastHeartbeat: number | null;
}, {
    id: string;
    apiKeyPrefix: string;
    status: "active" | "revoked";
    createdAt: number;
    revokedAt: number | null;
    lastHeartbeat: number | null;
}>;
export type AdminApiKey = z.infer<typeof AdminApiKey>;
export declare const AdminProfile: z.ZodObject<{
    id: z.ZodString;
    apiKeyId: z.ZodString;
    name: z.ZodString;
    tool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
    metadata: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: number;
    apiKeyId: string;
    name: string;
    tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    metadata: string | null;
}, {
    id: string;
    createdAt: number;
    apiKeyId: string;
    name: string;
    tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    metadata: string | null;
}>;
export type AdminProfile = z.infer<typeof AdminProfile>;
export declare const AdminSession: z.ZodObject<{
    id: z.ZodString;
    chatId: z.ZodNumber;
    apiKeyId: z.ZodString;
    apiKeyPrefix: z.ZodString;
    apiKeyLastHeartbeat: z.ZodNullable<z.ZodNumber>;
    profileId: z.ZodString;
    profileName: z.ZodString;
    profileTool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
    status: z.ZodEnum<["active", "revoked"]>;
    createdAt: z.ZodNumber;
    revokedAt: z.ZodNullable<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    id: string;
    apiKeyPrefix: string;
    status: "active" | "revoked";
    createdAt: number;
    revokedAt: number | null;
    apiKeyId: string;
    chatId: number;
    apiKeyLastHeartbeat: number | null;
    profileId: string;
    profileName: string;
    profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
}, {
    id: string;
    apiKeyPrefix: string;
    status: "active" | "revoked";
    createdAt: number;
    revokedAt: number | null;
    apiKeyId: string;
    chatId: number;
    apiKeyLastHeartbeat: number | null;
    profileId: string;
    profileName: string;
    profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
}>;
export type AdminSession = z.infer<typeof AdminSession>;
export declare const AdminMessage: z.ZodObject<{
    id: z.ZodString;
    sessionId: z.ZodString;
    content: z.ZodString;
    resumeLastSession: z.ZodDefault<z.ZodBoolean>;
    processingStartedAt: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    createdAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: number;
    sessionId: string;
    content: string;
    resumeLastSession: boolean;
    processingStartedAt: number | null;
}, {
    id: string;
    createdAt: number;
    sessionId: string;
    content: string;
    resumeLastSession?: boolean | undefined;
    processingStartedAt?: number | null | undefined;
}>;
export type AdminMessage = z.infer<typeof AdminMessage>;
export declare const ListApiKeysResponse: z.ZodObject<{
    apiKeys: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        apiKeyPrefix: z.ZodString;
        status: z.ZodEnum<["active", "revoked"]>;
        createdAt: z.ZodNumber;
        revokedAt: z.ZodNullable<z.ZodNumber>;
        lastHeartbeat: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        lastHeartbeat: number | null;
    }, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        lastHeartbeat: number | null;
    }>, "many">;
    total: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    apiKeys: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        lastHeartbeat: number | null;
    }[];
    total: number;
}, {
    apiKeys: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        lastHeartbeat: number | null;
    }[];
    total: number;
}>;
export type ListApiKeysResponse = z.infer<typeof ListApiKeysResponse>;
export declare const ApiKeyDetailResponse: z.ZodObject<{
    apiKey: z.ZodObject<{
        id: z.ZodString;
        apiKeyPrefix: z.ZodString;
        status: z.ZodEnum<["active", "revoked"]>;
        createdAt: z.ZodNumber;
        revokedAt: z.ZodNullable<z.ZodNumber>;
        lastHeartbeat: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        lastHeartbeat: number | null;
    }, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        lastHeartbeat: number | null;
    }>;
    profiles: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        apiKeyId: z.ZodString;
        name: z.ZodString;
        tool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
        metadata: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        createdAt: number;
        apiKeyId: string;
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
        metadata: string | null;
    }, {
        id: string;
        createdAt: number;
        apiKeyId: string;
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
        metadata: string | null;
    }>, "many">;
    sessions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        chatId: z.ZodNumber;
        apiKeyId: z.ZodString;
        apiKeyPrefix: z.ZodString;
        apiKeyLastHeartbeat: z.ZodNullable<z.ZodNumber>;
        profileId: z.ZodString;
        profileName: z.ZodString;
        profileTool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
        status: z.ZodEnum<["active", "revoked"]>;
        createdAt: z.ZodNumber;
        revokedAt: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    apiKey: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        lastHeartbeat: number | null;
    };
    profiles: {
        id: string;
        createdAt: number;
        apiKeyId: string;
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
        metadata: string | null;
    }[];
    sessions: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }[];
}, {
    apiKey: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        lastHeartbeat: number | null;
    };
    profiles: {
        id: string;
        createdAt: number;
        apiKeyId: string;
        name: string;
        tool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
        metadata: string | null;
    }[];
    sessions: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }[];
}>;
export type ApiKeyDetailResponse = z.infer<typeof ApiKeyDetailResponse>;
export declare const ListSessionsQuery: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["active", "revoked"]>>;
    chatId: z.ZodOptional<z.ZodNumber>;
    apiKeyId: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "revoked" | undefined;
    apiKeyId?: string | undefined;
    chatId?: number | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
}, {
    status?: "active" | "revoked" | undefined;
    apiKeyId?: string | undefined;
    chatId?: number | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
}>;
export type ListSessionsQuery = z.infer<typeof ListSessionsQuery>;
export declare const ListSessionsResponse: z.ZodObject<{
    sessions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        chatId: z.ZodNumber;
        apiKeyId: z.ZodString;
        apiKeyPrefix: z.ZodString;
        apiKeyLastHeartbeat: z.ZodNullable<z.ZodNumber>;
        profileId: z.ZodString;
        profileName: z.ZodString;
        profileTool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
        status: z.ZodEnum<["active", "revoked"]>;
        createdAt: z.ZodNumber;
        revokedAt: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }>, "many">;
    total: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    total: number;
    sessions: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }[];
}, {
    total: number;
    sessions: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }[];
}>;
export type ListSessionsResponse = z.infer<typeof ListSessionsResponse>;
export declare const SessionDetailResponse: z.ZodObject<{
    session: z.ZodObject<{
        id: z.ZodString;
        chatId: z.ZodNumber;
        apiKeyId: z.ZodString;
        apiKeyPrefix: z.ZodString;
        apiKeyLastHeartbeat: z.ZodNullable<z.ZodNumber>;
        profileId: z.ZodString;
        profileName: z.ZodString;
        profileTool: z.ZodEnum<["CLAUDE_CODE", "OPENAI", "CUSTOM"]>;
        status: z.ZodEnum<["active", "revoked"]>;
        createdAt: z.ZodNumber;
        revokedAt: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }, {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    }>;
    pending: z.ZodNumber;
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sessionId: z.ZodString;
        content: z.ZodString;
        resumeLastSession: z.ZodDefault<z.ZodBoolean>;
        processingStartedAt: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        createdAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession: boolean;
        processingStartedAt: number | null;
    }, {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession?: boolean | undefined;
        processingStartedAt?: number | null | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    session: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    };
    pending: number;
    messages: {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession: boolean;
        processingStartedAt: number | null;
    }[];
}, {
    session: {
        id: string;
        apiKeyPrefix: string;
        status: "active" | "revoked";
        createdAt: number;
        revokedAt: number | null;
        apiKeyId: string;
        chatId: number;
        apiKeyLastHeartbeat: number | null;
        profileId: string;
        profileName: string;
        profileTool: "CLAUDE_CODE" | "OPENAI" | "CUSTOM";
    };
    pending: number;
    messages: {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession?: boolean | undefined;
        processingStartedAt?: number | null | undefined;
    }[];
}>;
export type SessionDetailResponse = z.infer<typeof SessionDetailResponse>;
/** Kept for test compatibility with the old admin transport contract. */
export declare const ReservedOptionalKey: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodEffects<z.ZodLiteral<"">, undefined, "">]>;
export declare const EnqueueMessageBody: z.ZodObject<{
    content: z.ZodString;
    resumeLastSession: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    content: string;
    resumeLastSession?: boolean | undefined;
}, {
    content: string;
    resumeLastSession?: boolean | undefined;
}>;
export type EnqueueMessageBody = z.infer<typeof EnqueueMessageBody>;
export declare const EnqueueMessageResponse: z.ZodObject<{
    message: z.ZodObject<{
        id: z.ZodString;
        sessionId: z.ZodString;
        content: z.ZodString;
        resumeLastSession: z.ZodDefault<z.ZodBoolean>;
        processingStartedAt: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        createdAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession: boolean;
        processingStartedAt: number | null;
    }, {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession?: boolean | undefined;
        processingStartedAt?: number | null | undefined;
    }>;
    droppedOldestId: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    message: {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession: boolean;
        processingStartedAt: number | null;
    };
    droppedOldestId: string | null;
}, {
    message: {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession?: boolean | undefined;
        processingStartedAt?: number | null | undefined;
    };
    droppedOldestId: string | null;
}>;
export type EnqueueMessageResponse = z.infer<typeof EnqueueMessageResponse>;
export declare const UpdateMessageBody: z.ZodObject<{
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    content: string;
}, {
    content: string;
}>;
export type UpdateMessageBody = z.infer<typeof UpdateMessageBody>;
export declare const ListMessagesResponse: z.ZodObject<{
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sessionId: z.ZodString;
        content: z.ZodString;
        resumeLastSession: z.ZodDefault<z.ZodBoolean>;
        processingStartedAt: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        createdAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession: boolean;
        processingStartedAt: number | null;
    }, {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession?: boolean | undefined;
        processingStartedAt?: number | null | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    messages: {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession: boolean;
        processingStartedAt: number | null;
    }[];
}, {
    messages: {
        id: string;
        createdAt: number;
        sessionId: string;
        content: string;
        resumeLastSession?: boolean | undefined;
        processingStartedAt?: number | null | undefined;
    }[];
}>;
export type ListMessagesResponse = z.infer<typeof ListMessagesResponse>;
//# sourceMappingURL=admin.d.ts.map