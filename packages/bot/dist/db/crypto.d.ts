export interface GeneratedKey {
    rawApiKey: string;
    hash: string;
    prefix: string;
}
export declare function hashApiKey(raw: string): string;
export declare function generateApiKey(): GeneratedKey;
export declare function validateUserSuppliedKey(raw: string): void;
//# sourceMappingURL=crypto.d.ts.map