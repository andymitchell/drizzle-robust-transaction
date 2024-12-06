
import { QueueMemory} from '@andyrmitchell/utils';

import {PgTransaction } from 'drizzle-orm/pg-core';
import { exponentialBackoffWithJitter } from './expontentialBackoffWithJitter';
import { sql } from "drizzle-orm";
import type { Databases, Dialect,  PgDatabases, SqliteDatabases, SqliteOptions, SqliteTransactionModes } from "./types";
import { isDialectPg, isDialectSqlite } from "./types";





let memoryQueue:QueueMemory;
function getMemoryQueue() {
    if( !memoryQueue ) memoryQueue = new QueueMemory('');
    return memoryQueue;
}


/**
 * A drop in replacement for Drizzle's `db.transaction`. 
 * 
 * For pg it's just a pass through. 
 * 
 * For sqlite, it fixes a lot of driver inconsistencies to make sure that it can safely run two concurrent transactions without interleaving overlap. I.e. it becomes consistent with the way Postgres transactions behave.
 * 
 * @param dialect 
 * @param db 
 * @param callback 
 */
export async function robustTransaction<D extends PgDatabases, T>(dialect: 'pg', db:D, callback: (db:PgTransaction<any, any, any>) => T | PromiseLike<T>):Promise<T>
export async function robustTransaction<D extends SqliteDatabases, T>(dialect: 'sqlite', db:D, callback: (db:D) => T | PromiseLike<T>, options?: SqliteOptions):Promise<T>
export async function robustTransaction<D extends Databases, T>(dialect: Dialect, db:D, callback: (db:D | PgTransaction<any, any, any>) => T | PromiseLike<T>, options?: SqliteOptions):Promise<T> {

    let result:T;
    if( isDialectPg(dialect, db) ) {
        // Drizzle transactions behave perfectly well
        result = await new Promise<T>((accept) => {
            db.transaction(async (tx) => {
                tx
                accept(await callback(tx))
            })
        })
    } else if( isDialectSqlite(dialect, db) ) {
        

        const finalOptions:Required<SqliteOptions> = {
            busy_timeout: 5000,
            behavior: null,
            skip_global_memory_queue: false,
            verbose: false,
            ...options
        }
        

        const MODES:Record<SqliteTransactionModes, string> = {
            'deferred': 'DEFERRED',
            'immediate': 'IMMEDIATE',
            'exclusive': 'EXCLUSIVE'
        }
        let mode = finalOptions.behavior? MODES[finalOptions.behavior] : '';
        
        const transactionFailedErrors = [
            new RegExp("database is locked"),
            new RegExp("cannot start a transaction within a transaction")
        ]

        const run = () => exponentialBackoffWithJitter(
            async () => {
                // Cannot trust db.transaction when backed by BetterSqlite3: it will interleave concurrent transaction's writes
                // Cannot make LibSQL's driver honour any form of retry with busy_timeout: it will always throw "database is locked" immediately 
                // Cannot make BetterSqlite3's driver honour attempting to run two concurrent manual (BEGIN) transactions, it will throw "cannot start a transaction within a transaction"
                // Cannot use async code in BetterSqlite3's '.transaction' function

                await db.run(sql.raw(`BEGIN ${mode}`))

                try {
                    const result = await callback(db);
                    await db.run(sql.raw(`COMMIT`))
                    return result;
                } catch(e) {
                    await db.run(sql.raw(`ROLLBACK`))
                    throw e;
                }
            },
            {
                max_time_ms: finalOptions.busy_timeout,
                verbose: finalOptions.verbose,
                whitelist_only_error_messages: transactionFailedErrors
            }
        )

        if( finalOptions.skip_global_memory_queue ) {
            result = await run();
        } else {
            const q = getMemoryQueue();
            result = await q.enqueue(run);
        }
    } else {
        throw new Error("Unknown dialect");
    }

    

    return result;

}


