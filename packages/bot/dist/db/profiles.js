import { randomUUID } from "node:crypto";
function rowToRecord(row) {
    const n = typeof row.created_at === "number" ? row.created_at : Number(row.created_at);
    return {
        id: row.id,
        apiKeyId: row.api_key_id,
        name: row.name,
        tool: row.tool,
        metadata: row.metadata,
        createdAt: n
    };
}
export class ProfilesRepo {
    db;
    now;
    constructor(db, now = Date.now) {
        this.db = db;
        this.now = now;
    }
    /**
     * Replace an api_key's profile set with the supplied spec. Profile rows
     * matching by name are updated in place; new names are inserted; profiles
     * absent from the spec are deleted (cascading their sessions + messages).
     */
    async upsertForApiKey(apiKeyId, specs) {
        return this.db.transaction().execute(async (tx) => {
            const existing = await tx
                .selectFrom("profiles")
                .selectAll()
                .where("api_key_id", "=", apiKeyId)
                .execute();
            const existingByName = new Map(existing.map((r) => [r.name, r]));
            const specNames = new Set(specs.map((s) => s.name));
            const toDelete = existing
                .filter((r) => !specNames.has(r.name))
                .map((r) => r.id);
            if (toDelete.length > 0) {
                await tx.deleteFrom("profiles").where("id", "in", toDelete).execute();
            }
            for (const spec of specs) {
                const ex = existingByName.get(spec.name);
                if (ex) {
                    await tx
                        .updateTable("profiles")
                        .set({ tool: spec.tool, metadata: spec.metadata ?? null })
                        .where("id", "=", ex.id)
                        .execute();
                }
                else {
                    await tx
                        .insertInto("profiles")
                        .values({
                        id: randomUUID(),
                        api_key_id: apiKeyId,
                        name: spec.name,
                        tool: spec.tool,
                        metadata: spec.metadata ?? null,
                        created_at: this.now()
                    })
                        .execute();
                }
            }
            const rows = await tx
                .selectFrom("profiles")
                .selectAll()
                .where("api_key_id", "=", apiKeyId)
                .orderBy("created_at", "asc")
                .execute();
            return rows.map(rowToRecord);
        });
    }
    async listByApiKey(apiKeyId) {
        const rows = await this.db
            .selectFrom("profiles")
            .selectAll()
            .where("api_key_id", "=", apiKeyId)
            .orderBy("created_at", "asc")
            .execute();
        return rows.map(rowToRecord);
    }
    async getById(id) {
        const row = await this.db
            .selectFrom("profiles")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();
        return row ? rowToRecord(row) : null;
    }
    async getByApiKeyAndName(apiKeyId, name) {
        const row = await this.db
            .selectFrom("profiles")
            .selectAll()
            .where("api_key_id", "=", apiKeyId)
            .where("name", "=", name)
            .executeTakeFirst();
        return row ? rowToRecord(row) : null;
    }
}
//# sourceMappingURL=profiles.js.map