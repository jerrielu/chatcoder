import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import BetterSqlite3 from "better-sqlite3";
import pg from "pg";
import { runMigrations } from "./migrations.js";
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
export async function openDb(databaseUrl) {
    // eslint-disable-next-line no-console
    console.log(`[db] Opening database: ${databaseUrl} (cwd: ${process.cwd()})`);
    if (databaseUrl.startsWith("sqlite:")) {
        const path = resolveSqlitePath(databaseUrl);
        const sqlite = new BetterSqlite3(path);
        sqlite.pragma("journal_mode = WAL");
        sqlite.pragma("foreign_keys = ON");
        const db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
        await runMigrations(db, "sqlite");
        return {
            db,
            async close() {
                await db.destroy();
            }
        };
    }
    if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
        const pool = new pg.Pool({ connectionString: databaseUrl });
        const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
        await runMigrations(db, "postgres");
        return {
            db,
            async close() {
                await db.destroy();
            }
        };
    }
    throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}`);
}
function resolveSqlitePath(url) {
    const rest = url.slice("sqlite:".length);
    if (rest.length === 0)
        return ":memory:";
    const stripped = rest.startsWith("//") ? rest.slice(2) : rest;
    if (stripped.length === 0)
        return ":memory:";
    if (stripped === ":memory:")
        return ":memory:";
    // URL form: sqlite:///abs/path.db → "/abs/path.db"
    if (rest.startsWith("///"))
        return "/" + stripped.replace(/^\/+/, "");
    return stripped;
}
//# sourceMappingURL=index.js.map