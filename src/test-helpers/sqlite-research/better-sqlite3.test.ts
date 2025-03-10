import { ensureDirSync } from "fs-extra";
import { clearDir, getRelativeTestDir } from "../test-helpers.ts";
import { sleep } from "@andyrmitchell/utils";
import { uid } from "@andyrmitchell/utils/uid";
import Database from "better-sqlite3";


const TEST_DIR = getRelativeTestDir(import.meta.url, 'test-schemas/better-sqlite3');

beforeAll(() => {
    clearDir(TEST_DIR)
    ensureDirSync(TEST_DIR)
})

afterAll(() => {
    clearDir(TEST_DIR);
})

test('BetterSqlite3 blocks and waits for transactions when synchronous', async () => {

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


test('BetterSqlite3 cannot handle async code in transactions', async () => {
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


