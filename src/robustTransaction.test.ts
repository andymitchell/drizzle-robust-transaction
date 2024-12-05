import { ensureDirSync } from "fs-extra";
import { clearDir, getRelativeTestDir } from "./test-helpers";
import { uid } from "@andyrmitchell/utils";

import { drizzle as drizzlePg, PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzleLibsql, LibSQLDatabase } from 'drizzle-orm/libsql';
import {BetterSQLite3Database, drizzle as drizzleBetterSqlite} from 'drizzle-orm/better-sqlite3';
import * as sqlite from "drizzle-orm/sqlite-core";
import * as pg from "drizzle-orm/pg-core";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { robustTransaction } from "./robustTransaction";
import { isDialectPg, type Databases, type Dialect, type PgDatabases, type SqliteDatabases } from "./types";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";


const TEST_DIR = getRelativeTestDir(import.meta.url, 'test-schemas/robust-transactions');

beforeAll(() => {
    clearDir(TEST_DIR)
    ensureDirSync(TEST_DIR)
})

afterAll(() => {
    clearDir(TEST_DIR);
})

const pgSchemaString = sql`CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    run_id TEXT
);`;
const sqliteSchemaString = sql`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    run_id TEXT
)`;
const pgSchema = pg.pgTable('users', {
    id: pg.integer().primaryKey().generatedAlwaysAsIdentity(),
    name: pg.text().notNull(),
    run_id: pg.text()
})
const sqliteSchema = sqlite.sqliteTable('users', {
    id: sqlite.integer("id").primaryKey({ autoIncrement: true }),
    name: sqlite.text().notNull(),
    run_id: sqlite.text()
})

async function genericConcurrentTransactionTest(dialect: 'pg', db:PgDatabases, schema: typeof pgSchema):Promise<void>
async function genericConcurrentTransactionTest(dialect: 'sqlite', db:SqliteDatabases, schema: typeof sqliteSchema):Promise<void>
async function genericConcurrentTransactionTest(dialect: Dialect, db:Databases, schema: typeof pgSchema | typeof sqliteSchema):Promise<void> {
    if( isDialectPg(dialect, db) ) {
        await db.execute(pgSchemaString)
    } else {
        await db.run(sqliteSchemaString)
    }

    
    const typedDb = db as PgDatabases;
    const typedSchema = schema as typeof pgSchema;

    await typedDb.insert(typedSchema).values({ name: 'Alice' });

    const transactionStartedForRunIds:string[] = [];

    async function nextAvailable(run_id: string, name: string) {
        // @ts-ignore
        await robustTransaction(dialect as 'pg', typedDb, async (tx) => {
            console.log("OK");
            transactionStartedForRunIds.push(run_id);
            const items = await tx.select().from(typedSchema);
            

            console.log("Found items: ", items);
            const available = items.find(x => !x.run_id);
            if (available) {
                await tx
                    .update(typedSchema)
                    .set({
                        name,
                        run_id
                    })
                    .where(
                        eq(sqliteSchema.id, available.id)
                    )
            }

        }, {
            skip_global_memory_queue: true, // The global memory queue makes the test too easy, as the DB would never face true concurrency
            verbose: true
        })
    }

    let runId1 = uid();
    let runId2 = uid();

    const txPath1 = new Promise<void>(async (accept) => {
        await nextAvailable(runId1, 'Bob');
        accept();
    })

    //await txPath1;

    const txPath2 = new Promise<void>(async (accept) => {
        await nextAvailable(runId2, 'Charleen');
        accept();
    })

    await txPath1;
    await txPath2;

    const result = await typedDb.select().from(typedSchema);

    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('Bob');
    expect(transactionStartedForRunIds).toEqual([runId1, runId2]); // Both must be started

}



test('genericConcurrentTransactionTest pglite', async () => {


    const client = new PGlite();
    const db = drizzlePg(client);

    await genericConcurrentTransactionTest('pg', db, pgSchema);

})

test('genericConcurrentTransactionTest better-sqlite3 [wall off, busy timeout off]', async () => {

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 

    const client = new Database(url, { timeout: 0 });
    //client.pragma('journal_mode = WAL');
    //client.pragma('busy_timeout = 5000');

    const db = drizzleBetterSqlite({ client });

    await genericConcurrentTransactionTest('sqlite', db, sqliteSchema);

})


test('genericConcurrentTransactionTest better-sqlite3 [wall on, busy timeout off]', async () => {

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 

    const client = new Database(url, { timeout: 0 });
    client.pragma('journal_mode = WAL');
    //client.pragma('busy_timeout = 5000');

    const db = drizzleBetterSqlite({ client });

    await genericConcurrentTransactionTest('sqlite', db, sqliteSchema);

})


test('genericConcurrentTransactionTest better-sqlite3 [wall off, busy timeout on]', async () => {

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 

    const client = new Database(url, { timeout: 5000 });
    //client.pragma('journal_mode = WAL');
    client.pragma('busy_timeout = 5000');

    const db = drizzleBetterSqlite({ client });

    await genericConcurrentTransactionTest('sqlite', db, sqliteSchema);

})


test('genericConcurrentTransactionTest libsql [wall off, busy timeout off]', async () => {

    const url = `file:${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 
    
    const preClient = createClient({
        url
    });

    //await preClient.execute('PRAGMA journal_mode = WAL;'); // Speeds things up 
    
    
    preClient.close();

    const client = createClient({
        url
    });

    //await client.execute('PRAGMA busy_timeout = 5000;'); // Allows it to retry rather than instantly failing 

    const db = drizzleLibsql(client);
    await genericConcurrentTransactionTest('sqlite', db, sqliteSchema);

})


test('genericConcurrentTransactionTest libsql [wall on, busy timeout off]', async () => {

    const url = `file:${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 
    
    const preClient = createClient({
        url
    });

    await preClient.execute('PRAGMA journal_mode = WAL;'); // Speeds things up 
    
    
    preClient.close();

    const client = createClient({
        url
    });

    //await client.execute('PRAGMA busy_timeout = 5000;'); // Allows it to retry rather than instantly failing 

    const db = drizzleLibsql(client);
    await genericConcurrentTransactionTest('sqlite', db, sqliteSchema);

})


test('genericConcurrentTransactionTest libsql [wall off, busy timeout on]', async () => {

    const url = `file:${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 
    
    const preClient = createClient({
        url
    });

    //await preClient.execute('PRAGMA journal_mode = WAL;'); // Speeds things up 
    
    
    preClient.close();

    const client = createClient({
        url
    });

    await client.execute('PRAGMA busy_timeout = 5000;'); // Allows it to retry rather than instantly failing 

    const db = drizzleLibsql(client);
    await genericConcurrentTransactionTest('sqlite', db, sqliteSchema);

})