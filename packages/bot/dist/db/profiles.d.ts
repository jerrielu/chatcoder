import type { ToolKind } from "@chatcoder/shared";
import type { Db } from "./index.js";
export interface ProfileRecord {
    id: string;
    apiKeyId: string;
    name: string;
    tool: ToolKind;
    metadata: string | null;
    createdAt: number;
}
export interface ProfileUpsertSpec {
    name: string;
    tool: ToolKind;
    metadata?: string | null;
}
export declare class ProfilesRepo {
    private readonly db;
    private readonly now;
    constructor(db: Db, now?: () => number);
    /**
     * Replace an api_key's profile set with the supplied spec. Profile rows
     * matching by name are updated in place; new names are inserted; profiles
     * absent from the spec are deleted (cascading their sessions + messages).
     */
    upsertForApiKey(apiKeyId: string, specs: ProfileUpsertSpec[]): Promise<ProfileRecord[]>;
    listByApiKey(apiKeyId: string): Promise<ProfileRecord[]>;
    getById(id: string): Promise<ProfileRecord | null>;
    getByApiKeyAndName(apiKeyId: string, name: string): Promise<ProfileRecord | null>;
}
//# sourceMappingURL=profiles.d.ts.map