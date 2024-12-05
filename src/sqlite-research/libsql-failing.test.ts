import { test } from 'vitest';
import { fileURLToPath } from 'url';
import { createClient } from "@libsql/client"; // "^0.14.0"
import {v4 as uuidv4} from 'uuid';
import {dirname} from 'path';
import { drizzle as drizzleLibsql, LibSQLDatabase } from 'drizzle-orm/libsql';
import * as pg from "drizzle-orm/pg-core";

import { clearDir, getRelativeTestDir } from '../test-helpers';
import { ensureDirSync} from 'fs-extra';
import { eq, sql } from 'drizzle-orm';
import { uid } from '@andyrmitchell/utils';

// LibSql doesn't seem to support busy_timeout https://www.sqlite.org/c3ref/busy_timeout.html 
// This means that two transactions that overlap will result in a "database is locked" error, and the app code has to handle retrying.
//  An overlap is very common in an async codebase. 
// I have requested clarity on LibSql's plans at https://github.com/tursodatabase/libsql-client-ts/issues/288

// This test proves that busy_timeout is ignored, by showing it throw an error. 
// IF THIS TEST FAILS, THAT IS GREAT! IT MEANS LIBSQL NOW SUPPORTS BUSY_TIMEOUT. 



const TEST_DIR = getRelativeTestDir(import.meta.url, 'test-schemas/libsql');

beforeAll(() => {
    clearDir(TEST_DIR)
    ensureDirSync(TEST_DIR)
})

afterAll(() => {
    clearDir(TEST_DIR);
})


test(`LibSql fails at concurrent transactions even with busy_timeout`, async () => {
    const testDir = `${dirname(fileURLToPath(import.meta.url))}/test-schemas`
    

    const url = `file:${testDir}/${uuidv4()}.db`

    // Turn on WAL mode. Speeding things up, making a transaction collision less likely. 
    /*
    // Disabled, because it makes no difference to the test
    const preClient = createClient({
        url
    });
    await preClient.execute('PRAGMA journal_mode = WAL;'); // Speeds things up, so collisions less likely. Makes no difference to the transactions failing. 
    preClient.close();
    */

    const client = createClient({
        url
    });

    // This should make Sqlite retry when it encounters a lock; but it's not having an impact. https://www.sqlite.org/c3ref/busy_timeout.html 
    // In contrast, this logic works with BetterSqlite3. 
    await client.execute('PRAGMA busy_timeout = 5000;'); 

    await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    `);

    let databaseLockedError = false;

    try {
        // Wrap a transaction in a promise, so it can run concurrently
        const txPath1 = new Promise<void>(async (accept, reject) => {
            try {
                const tx = await client.transaction('write');
                await tx.execute({ sql: 'INSERT INTO users (name) VALUES (?)', args: ['Alice'] });
                await tx.execute({ sql: 'INSERT INTO users (name) VALUES (?)', args: ['Bob'] });
                await tx.commit()
                accept();
            } catch (e) {
                reject(e);
            }

        });

        // await txPath1; // If uncommented, this succeeds as it makes it run linear

        // Wrap a transaction in a promise, so it can run concurrently
        const txPath2 = new Promise<void>(async (accept, reject) => {
            try {
                const tx2 = await client.transaction('write'); // Throws error here: "SqliteError: database is locked" / { code: 'SQLITE_BUSY', rawCode: 5 }
                await tx2.execute({ sql: 'INSERT INTO users (name) VALUES (?)', args: ['Charleen'] });
                await tx2.execute({ sql: 'INSERT INTO users (name) VALUES (?)', args: ['David'] });
                await tx2.commit()
                accept();
            } catch (e) {
                reject(e);
            }

        });

        await Promise.all([txPath1, txPath2]);

        // Verify the data
        const resultFinal = await client.execute('SELECT * FROM users');
        expect(resultFinal.rows.length).toBe(4);
    } catch(e) {
        if( e instanceof Error && e.message.indexOf('database is locked')>-1 ) {
            databaseLockedError = true
        } else {
            throw e;
        }
    }

    // See above - it's good news if this fails! 
    expect(databaseLockedError).toBe(true);
    
})


test.only('Drizzle can be worked around to handle await in transactions backed by LibSql', async () => {

    const url = `file:${TEST_DIR}/${uuidv4()}.db`

    // Turn on WAL mode. Speeding things up, making a transaction collision less likely. 
    /*
    // Disabled, because it makes no difference to the test
    const preClient = createClient({
        url
    });
    await preClient.execute('PRAGMA journal_mode = WAL;'); // Speeds things up, so collisions less likely. Makes no difference to the transactions failing. 
    preClient.close();
    */

    const client = createClient({
        url
    });

    // This should make Sqlite retry when it encounters a lock; but it's not having an impact. https://www.sqlite.org/c3ref/busy_timeout.html 
    // In contrast, this logic works with BetterSqlite3. 
    //await client.execute('PRAGMA busy_timeout = 5000;'); 

    const db = drizzleLibsql(client);

    await db.run(sql`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            run_id TEXT
        )
    `)

    let currentTransaction: null | Promise<void> = null;
    const runTransaction = async <
        T,
        TQueryResult,
        TSchema extends Record<string, unknown> = Record<string, never>
    >(
        db: LibSQLDatabase,//sqlite.BaseSQLiteDatabase<"async", TQueryResult, TSchema>,
        executor: () => Promise<T>
    ) => {
        while (currentTransaction !== null) {
            await currentTransaction;
        }
        let resolve!: () => void;
        currentTransaction = new Promise<void>(_resolve => {
            resolve = _resolve;
        });
        try {
            await db.run(sql.raw(`BEGIN`))//.execute();

            try {
                const result = await executor();
                await db.run(sql.raw(`COMMIT`));
                return result;
            } catch (error) {
                await db.run(sql.raw(`ROLLBACK`));
                throw error;
            }
        } finally {
            resolve();
            currentTransaction = null;
        }
    };

    const schema = pg.pgTable('users', {
        id: pg.integer().primaryKey().generatedAlwaysAsIdentity(),
        name: pg.text().notNull(),
        run_id: pg.text()
    })

    await db.insert(schema).values({ name: 'Alice' });

    async function nextAvailable(run_id: string, name: string) {
        await runTransaction(db, async () => {
            const items = await db.select().from(schema);


            console.log("Found items: ", items);
            const available = items.find(x => !x.run_id);
            if (available) {
                await db
                    .update(schema)
                    .set({
                        name,
                        run_id
                    })
                    .where(
                        eq(schema.id, available.id)
                    )
            }

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

    const result = await db.select().from(schema);

    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('Bob');



})