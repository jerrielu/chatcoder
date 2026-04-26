import type { Kysely } from "kysely";
import type { Database } from "./schema.js";
export type Dialect = "sqlite" | "postgres";
/**
 * Fresh install: create all tables at version 1. There is no migration from
 * the old single-session schema — the user deletes the DB and starts over.
 */
export declare function runMigrations(db: Kysely<Database>, dialect: Dialect): Promise<void>;
//# sourceMappingURL=migrations.d.ts.map