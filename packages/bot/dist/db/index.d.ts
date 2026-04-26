import { Kysely } from "kysely";
import type { Database } from "./schema.js";
export type Db = Kysely<Database>;
export interface DbHandle {
    db: Db;
    close: () => Promise<void>;
}
/**
 * Accepts:
 *   sqlite::memory:
 *   sqlite://:memory:
 *   sqlite:/abs/path.db            (single-slash absolute form)
 *   sqlite:///abs/path.db          (URL-style absolute form)
 *   sqlite:relative.db
 *   sqlite://relative.db
 *   postgres://user:pw@host:port/database
 *   postgresql://…
 */
export declare function openDb(databaseUrl: string): Promise<DbHandle>;
//# sourceMappingURL=index.d.ts.map