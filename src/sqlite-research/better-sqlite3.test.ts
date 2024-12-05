import { ensureDirSync } from "fs-extra";
import { clearDir, getRelativeTestDir } from "../test-helpers";
import { sleep, uid } from "@andyrmitchell/utils";
import Database from "better-sqlite3";
import { BetterSQLite3Database, drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3';
import { eq, sql } from "drizzle-orm";
import * as sqlite from "drizzle-orm/sqlite-core";


const TEST_DIR = getRelativeTestDir(import.meta.url, 'test-schemas/better-sqlite3');

beforeAll(() => {
    clearDir(TEST_DIR)
    ensureDirSync(TEST_DIR)
})

afterAll(() => {
    clearDir(TEST_DIR);
})

test('BetterSqlite3 blocks and waits for transactions', async () => {

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 


    const client = new Database(url, { timeout: 0 });
    //client.pragma('journal_mode = WAL');
    //client.pragma('busy_timeout = 0');

    client.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    `);


    const txPath1 = new Promise<void>((accept) => {
        client.transaction(() => {
            client.prepare("INSERT INTO users (name) VALUES (@name)").run({ name: 'Alice' });
            client.prepare("UPDATE users SET name = @name").run({ name: 'Bob' });
        }).deferred()
        accept();
    })

    const txPath2 = new Promise<void>((accept) => {
        client.transaction(() => {
            const result = client.prepare('SELECT * FROM users').all();
            if (result.length > 0) {
                client.prepare("UPDATE users SET name = @name").run({ name: 'Charleen' });
                client.prepare("UPDATE users SET name = @name").run({ name: 'David' });
            }
        }).deferred()
        accept();
    })

    await txPath1;
    await txPath2;

    const result = client.prepare('SELECT * FROM users').all() as { id: number, name: string }[];
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('David');

})


test('BetterSqlite3 cannot handle await in transactions', async () => {
    // This is confirmed under 'caveats' in https://github.com/WiseLibs/better-sqlite3/blob/HEAD/docs/api.md#transactionfunction---function 

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 


    const client = new Database(url, { timeout: 0 });
    //client.pragma('journal_mode = WAL');
    //client.pragma('busy_timeout = 0');

    client.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    `);


    const txPath1 = new Promise<void>((accept) => {
        client.transaction(async () => {
            await sleep(10);
            client.prepare("INSERT INTO users (name) VALUES (@name)").run({ name: 'Alice' });
            client.prepare("UPDATE users SET name = @name").run({ name: 'Bob' });
        }).deferred()
        accept();
    })

    const txPath2 = new Promise<void>((accept) => {
        client.transaction(async () => {
            await sleep(10);
            const result = client.prepare('SELECT * FROM users').all();
            if (result.length > 0) {
                client.prepare("UPDATE users SET name = @name").run({ name: 'Charleen' });
                client.prepare("UPDATE users SET name = @name").run({ name: 'David' });
            }
        }).deferred()
        accept();
    })

    await txPath1;
    await txPath2;

    const result = client.prepare('SELECT * FROM users').all() as { id: number, name: string }[];
    expect(result.length).toBe(0); // The await causes the transaction to cancel 


})


test('BetterSqlite3 transactions prevent interleaving so long as the code inside the transaction is synchronous', async () => {
    // This is confirmed under 'caveats' in https://github.com/WiseLibs/better-sqlite3/blob/HEAD/docs/api.md#transactionfunction---function 

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 


    const client = new Database(url, { timeout: 0 });
    //client.pragma('journal_mode = WAL');
    //client.pragma('busy_timeout = 0');

    client.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            run_id TEXT
        )
    `);

    client.prepare("INSERT INTO users (name) VALUES (@name)").run({ name: 'Alice' });

    function nextAvailable(run_id: string, name: string) {
        client.transaction(() => {
            const items = client.prepare('SELECT * FROM users').all() as { id: number, name: string, run_id: string }[];


            console.log("Found items: ", items);
            const available = items.find(x => !x.run_id);
            if (available) {
                client.prepare("UPDATE users SET name = @name, run_id = @run_id").run({ name, run_id });
            }

        }).deferred()
    }

    let runId1 = uid();
    let runId2 = uid();

    const txPath1 = new Promise<void>((accept) => {
        nextAvailable(runId1, 'Bob');
        accept();
    })

    //await txPath1;

    const txPath2 = new Promise<void>((accept) => {
        nextAvailable(runId2, 'Charleen');
        accept();
    })

    await txPath1;
    await txPath2;

    const result = client.prepare('SELECT * FROM users').all() as { id: number, name: string }[];

    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('Bob');


})




test('Drizzle backed by BetterSqlite3 cannot handle await in transactions', async () => {


    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 

    const client = new Database(url, { timeout: 0 });
    //client.pragma('journal_mode = WAL');
    //client.pragma('busy_timeout = 0');

    const db = drizzleBetterSqlite({ client });

    db.run(sql`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            run_id TEXT
        )
    `)

    const schema = sqlite.sqliteTable('users', {
        id: sqlite.integer("id").primaryKey({ autoIncrement: true }),
        name: sqlite.text().notNull(),
        run_id: sqlite.text()
    })

    await db.insert(schema).values({ name: 'Alice' });

    async function nextAvailable(run_id: string, name: string) {
        await db.transaction(async () => {
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

        }, {
            behavior: 'exclusive'
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


test.only('Drizzle can be worked around to handle await in transactions backed by BetterSqlite3', async () => {


    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 

    const client = new Database(url, { timeout: 5000 });
    //client.pragma('journal_mode = WAL');
    client.pragma('busy_timeout = 5000');

    const db = drizzleBetterSqlite({ client });

    db.run(sql`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            run_id TEXT
        )
    `)

    //let currentTransaction: null | Promise<void> = null;
    const runTransaction = async <
        T,
        TQueryResult,
        TSchema extends Record<string, unknown> = Record<string, never>
    >(
        db: BetterSQLite3Database,//sqlite.BaseSQLiteDatabase<"async", TQueryResult, TSchema>,
        executor: () => Promise<T>
    ) => {
        //while (currentTransaction !== null) {
        //    await currentTransaction;
        //}
        //let resolve!: () => void;
        //currentTransaction = new Promise<void>(_resolve => {
        //    resolve = _resolve;
        //});
        try {
            //await db.run(sql.raw(`BEGIN EXCLUSIVE`))//.execute();
            client.prepare('BEGIN IMMEDIATE').run();

            try {
                const result = await executor();
                //await db.run(sql.raw(`COMMIT`));
                client.prepare('COMMIT').run();
                return result;
            } catch (error) {
                //await db.run(sql.raw(`ROLLBACK`));
                client.prepare('ROLLBACK').run();
                throw error;
            }
        } catch(e) {
            if( e instanceof Error ) {
                console.log("Error in run: ", e.message)
            }
        } finally {
            //resolve();
            //currentTransaction = null;
        }
    };

    const schema = sqlite.sqliteTable('users', {
        id: sqlite.integer("id").primaryKey({ autoIncrement: true }),
        name: sqlite.text().notNull(),
        run_id: sqlite.text()
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