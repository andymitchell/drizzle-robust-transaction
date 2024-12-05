

import { PgliteDatabase } from "drizzle-orm/pglite";
import { LibSQLDatabase } from 'drizzle-orm/libsql';
import {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';


import {type PgDatabase } from 'drizzle-orm/pg-core';




export type Dialect = 'pg' | 'sqlite';
export type SqliteTransactionModes = 'deferred' | 'immediate' | 'exclusive';
export type SqliteDatabases = LibSQLDatabase | BetterSQLite3Database;
export type PgDatabases = PgliteDatabase | PgDatabase<any>;
export type Databases = SqliteDatabases | PgDatabases;
export type SqliteOptions = {
    busy_timeout?: number,
    skip_global_memory_queue?: boolean,
    behavior?: null | SqliteTransactionModes,
    verbose?: boolean
}

export function isDialectPg(dialect:Dialect, db:Databases):db is PgDatabases {
    return dialect==='pg';
}
export function isDialectSqlite(dialect:Dialect, db:Databases):db is SqliteDatabases {
    return dialect==='sqlite';
}