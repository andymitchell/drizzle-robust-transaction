import type { DdtSqliteTransactionMode } from "@andyrmitchell/drizzle-dialect-types";




export type SqliteOptions = {
    busy_timeout?: number,
    skip_global_memory_queue?: boolean,
    behavior?: null | DdtSqliteTransactionMode,
    verbose?: boolean
}
