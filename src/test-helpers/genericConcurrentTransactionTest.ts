import { uid } from "@andyrmitchell/utils";

import * as sqlite from "drizzle-orm/sqlite-core";
import * as pg from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { robustTransaction } from "../robustTransaction";
import { isDialectPg, type Databases, type Dialect, type PgDatabases, type SqliteDatabases } from "../types";


const pgSchemaString = `CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    run_id TEXT
);`;
const sqliteSchemaString = `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    run_id TEXT
)`;

/*
const pgSchemaSql = sql`CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    run_id TEXT
);`;
const sqliteSchemaSql = sql`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    run_id TEXT
)`;
*/

export const pgSchema = pg.pgTable('users', {
    id: pg.integer().primaryKey().generatedAlwaysAsIdentity(),
    name: pg.text().notNull(),
    run_id: pg.text()
})
export const sqliteSchema = sqlite.sqliteTable('users', {
    id: sqlite.integer("id").primaryKey({ autoIncrement: true }),
    name: sqlite.text().notNull(),
    run_id: sqlite.text()
})


type SchemaRow = {id: number, name: string, run_id?: string | null};
type ExecutorActions = {name: 'list'} | {name: 'execute', raw_sql:string};
type Executor = (action:ExecutorActions, tx?: Databases | pg.PgTransaction<any> | sqlite.SQLiteTransaction<any, any, any, any>) => Promise<{rows: SchemaRow[]}>
export type TestExpectations = 'success' | 'custom';

export function createDrizzleExecutor(dialect: 'pg', db:PgDatabases):Executor;
export function createDrizzleExecutor(dialect: 'sqlite', db:SqliteDatabases):Executor;
export function createDrizzleExecutor(dialect: Dialect, db:Databases):Executor {
  

    if( isDialectPg(dialect, db) ) {
        return async (action, tx?) => {
            const finalDb = (tx as pg.PgTransaction<any>) ?? db;
            let rows:SchemaRow[] = [];
            
            if( action.name==='list' ) {
                
                const result = await finalDb.select().from(pgSchema);
                
                rows = result
            } else if( action.name==='execute' ) {
                await finalDb.execute(sql.raw(action.raw_sql));
            }
            return {
                rows
            }
        }
    } else {
        return async (action, tx?) => {
            const finalDb = (tx as SqliteDatabases) ?? db;
            let rows:SchemaRow[] = [];
            
            if( action.name==='list' ) {
                const result = await finalDb.select().from(sqliteSchema);
                rows = result
            } else if( action.name==='execute' ) {
                await finalDb.run(sql.raw(action.raw_sql));
            }
            return {
                rows
            }
        }
    }
}





type Returns = {run_id_1:string, run_id_2: string, run_transactions_started:string[], list:SchemaRow[]};
//export async function genericConcurrentTransactionTest(dialect: 'pg', execute:Executor, customTransaction: (callback:(tx:PgDatabases | pg.PgTransaction<any>) => any) => Promise<void>, testExpectations?:TestExpectations):Promise<Returns>
//export async function genericConcurrentTransactionTest(dialect: 'sqlite', execute:Executor, customTransaction: (callback:(tx:SqliteDatabases | sqlite.SQLiteTransaction<any, any, any, any>) => any) => Promise<void>, testExpectations?:TestExpectations):Promise<Returns>
/**
 * This test runs two transactions concurrently.
 * 
 * If it succeeds, it's expected that: 
 * - The first run set the run_id and name, and used up the 'available' slot
 * - The second run does start, but makes no changes (because the 'available' slot is used)
 * 
 * What tends to happen when it fails is that either:
 * - the 2nd run never starts (it's blocked)
 * - it interleaves with transaction 1 so it ends up setting runId2 (because transaction 2's SELECT happens before transaction 1's UPDATE; thus thinking there's still a slot available)
 * 
 * @param dialect 
 * @param execute A completely database/orm agnostic way to read/write the database
 * @param customTransaction The transaction mechanism to test. E.g. robustTransaction, or drizzle's inbuilt transactions, etc. 
 * @param testExpectations Whether to enforce success expectations, or let the calling-test decide how to evaluate it (e.g. to check it failed as it expects)
 * @returns 
 */
export async function genericConcurrentTransactionTest(dialect: Dialect, execute:Executor, customTransaction: (callback:(tx:Databases | pg.PgTransaction<any> | sqlite.SQLiteTransaction<any, any, any, any>) => any) => Promise<void>, testExpectations?:TestExpectations):Promise<Returns> {
    
    if( dialect==='pg' ) {
        await execute({name: 'execute', raw_sql: pgSchemaString})
    } else {
        await execute({name: 'execute', raw_sql: sqliteSchemaString})
    }

    await execute({name: 'execute', raw_sql: `INSERT INTO users (name) VALUES('Alice')`});
    

    const transactionStartedForRunIds:string[] = [];

    async function nextAvailable(run_id: string, name: string) {
        
        await customTransaction( async (tx) => {
            
            transactionStartedForRunIds.push(run_id);
            const itemsResult = await execute({name: 'list'}, tx);
            const items = itemsResult.rows;
            

            
            const available = items.find(x => !x.run_id);
            if (available) {
                await execute({name: 'execute', raw_sql:`UPDATE users SET name = '${name}', run_id = '${run_id}' WHERE id = ${available.id}`}, tx);
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

    const result = (await execute({name: 'list'})).rows;

    if( !testExpectations ) testExpectations = 'success';
    switch(testExpectations) {
        case 'success':
            expect(result.length).toBe(1);
            expect(result[0]!.name).toBe('Bob');
            expect(transactionStartedForRunIds).toEqual([runId1, runId2]); // Both must be started
            break;
        case 'custom':
            // Expect caller to do tests
            break;
    }

    return {
        run_id_1: runId1,
        run_id_2: runId2,
        run_transactions_started: transactionStartedForRunIds,
        list: result
    }

}

export async function genericConcurrentTransactionTestInDrizzleWithRobustTransaction<D extends Dialect, DB extends Databases>(dialect: D, db:DB):Promise<Returns> {

    return await genericConcurrentTransactionTest(dialect as 'pg', createDrizzleExecutor(dialect as 'pg', db as PgDatabases), async (callback) => {
        
        return robustTransaction(dialect, db, callback, {
            skip_global_memory_queue: true, // The global memory queue makes the test too easy, as the DB would never face true concurrency
            verbose: true
        })
    });

}
