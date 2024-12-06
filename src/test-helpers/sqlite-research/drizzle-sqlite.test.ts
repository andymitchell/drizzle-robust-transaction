import { ensureDirSync } from "fs-extra";
import { clearDir, getRelativeTestDir } from "../test-helpers";
import { uid } from "@andyrmitchell/utils";
import Database from "better-sqlite3";
import {  drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3';
import { createDrizzleExecutor, genericConcurrentTransactionTest, type TestExpectations } from "../genericConcurrentTransactionTest";
import type { SqliteDatabases } from "../../types";
import { createClient } from "@libsql/client";
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';

const TEST_DIR = getRelativeTestDir(import.meta.url, 'test-schemas/drizzle');

beforeAll(() => {
    clearDir(TEST_DIR)
    ensureDirSync(TEST_DIR)
})

afterAll(() => {
    clearDir(TEST_DIR);
})

async function genericConcurrentTransactionTestForSqliteDrizzle(db:SqliteDatabases, testExpectations?:TestExpectations) {
    let error:Error | undefined;
    const result = await genericConcurrentTransactionTest(
        'sqlite', 
        createDrizzleExecutor('sqlite', db), 
        async (callback) => {
            try {
                await db.transaction(async tx => {
                    await callback(tx);
                })
            } catch(e) {
                if( e instanceof Error ) error = e;
            }
        },
        testExpectations
    );

    return {
        ...result,
        error
    }
}

describe('better-sqlite3 aborts on async code in transaction, so will wrongly apply the 2nd run (which should never happen if the 1st run completes first, as that would take up the available slot)', () => {
    test(`better-sqlite3 [wal off, busy_timeout 0]`, async () => {
        const url = `${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 
    
        const client = new Database(url, { timeout: 0 });
        //client.pragma('journal_mode = WAL');
        //client.pragma('busy_timeout = 0');
    
        const db = drizzleBetterSqlite({ client });
    
        const result = await genericConcurrentTransactionTestForSqliteDrizzle(db, 'custom');
    
        expect(result.list[0]?.run_id).toBe(result.run_id_2);
        
    })
})


describe(`libsql will throw an instant 'database is locked' error on 2nd run, if it starts while the first transaction is running`, () => {
    test(`libsql [wal off, busy_timeout 0]`, async () => {
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
    
        const result = await genericConcurrentTransactionTestForSqliteDrizzle(db, 'custom');
    
        expect(result.error!.message.indexOf('database is locked')>-1).toBe(true);
        expect(result.run_transactions_started.length).toBe(1); // Should be 2 if it doesn't crash    
        
    })

    test(`libsql [wal off, busy_timeout 5000]`, async () => {
        const url = `file:${TEST_DIR}/test-${uid()}.db` // Switched to eliminate possible resets with connection drops 
        
        const preClient = createClient({
            url
        });
    
        //await preClient.execute('PRAGMA journal_mode = WAL;'); // Speeds things up 
        
        
        preClient.close();
    
        const client = createClient({
            url
        });
    
        await client.execute('PRAGMA busy_timeout = 5000;'); // Allows it to retry rather than instantly failing. Doesn't appear to have any effect in libsql: https://github.com/tursodatabase/libsql-client-ts/issues/288 
    
        const db = drizzleLibsql(client);
    
        const result = await genericConcurrentTransactionTestForSqliteDrizzle(db, 'custom');
    
        expect(result.error!.message.indexOf('database is locked')>-1).toBe(true);
        expect(result.run_transactions_started.length).toBe(1); // Should be 2 if it doesn't crash    
        
    })
})
