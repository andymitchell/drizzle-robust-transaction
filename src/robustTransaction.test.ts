import { ensureDirSync } from "fs-extra";
import { clearDir, getRelativeTestDir } from "./test-helpers/test-helpers";
import { uid } from "@andyrmitchell/utils";

import { drizzle as drizzlePg } from "drizzle-orm/pglite";
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { drizzle as drizzleBetterSqlite} from 'drizzle-orm/better-sqlite3';

import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";
import {  genericConcurrentTransactionTestInDrizzleWithRobustTransaction} from "./test-helpers/genericConcurrentTransactionTest";


const TEST_DIR = getRelativeTestDir(import.meta.url, 'test-schemas/robust-transactions');

beforeAll(() => {
    clearDir(TEST_DIR)
    ensureDirSync(TEST_DIR)
})

afterAll(() => {
    clearDir(TEST_DIR);
})




test('genericConcurrentTransactionTestInDrizzleWithRobustTransaction pglite', async () => {


    const client = new PGlite();
    const db = drizzlePg(client);

    await genericConcurrentTransactionTestInDrizzleWithRobustTransaction('pg', db);

}, 1000*10)

test('genericConcurrentTransactionTestInDrizzleWithRobustTransaction better-sqlite3 [wall off, busy timeout off]', async () => {

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 

    const client = new Database(url, { timeout: 0 });
    //client.pragma('journal_mode = WAL');
    //client.pragma('busy_timeout = 5000');

    const db = drizzleBetterSqlite({ client });

    await genericConcurrentTransactionTestInDrizzleWithRobustTransaction('sqlite', db);

})


test('genericConcurrentTransactionTestInDrizzleWithRobustTransaction better-sqlite3 [wall on, busy timeout off]', async () => {

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 

    const client = new Database(url, { timeout: 0 });
    client.pragma('journal_mode = WAL');
    //client.pragma('busy_timeout = 5000');

    const db = drizzleBetterSqlite({ client });

    await genericConcurrentTransactionTestInDrizzleWithRobustTransaction('sqlite', db);


})


test('genericConcurrentTransactionTestInDrizzleWithRobustTransaction better-sqlite3 [wall off, busy timeout on]', async () => {

    const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 

    const client = new Database(url, { timeout: 5000 });
    //client.pragma('journal_mode = WAL');
    client.pragma('busy_timeout = 5000');

    const db = drizzleBetterSqlite({ client });

    await genericConcurrentTransactionTestInDrizzleWithRobustTransaction('sqlite', db);

})


test('genericConcurrentTransactionTestInDrizzleWithRobustTransaction libsql [wall off, busy timeout off]', async () => {

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
    await genericConcurrentTransactionTestInDrizzleWithRobustTransaction('sqlite', db);

})


test('genericConcurrentTransactionTestInDrizzleWithRobustTransaction libsql [wall on, busy timeout off]', async () => {

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
    await genericConcurrentTransactionTestInDrizzleWithRobustTransaction('sqlite', db);

})


test('genericConcurrentTransactionTestInDrizzleWithRobustTransaction libsql [wall off, busy timeout on]', async () => {

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
    await genericConcurrentTransactionTestInDrizzleWithRobustTransaction('sqlite', db);

})