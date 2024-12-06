Drizzle transactions that will always run sequentially. Compatible with Postgres and Sqlite. 

It essentially makes Sqlite transactions behave the same way as Postgres transactions, which currently* Drizzle does not (*as of drizzle-orm 0.36.4).

# The problem

Sqlite's transaction handling is a bag of snakes. 

Specifically:
- Cannot trust db.transaction when backed by BetterSqlite3: it will interleave concurrent transaction's writes
- Cannot make LibSQL's driver honour any form of retry with busy_timeout: it will always throw "database is locked" immediately and give up
- Cannot make BetterSqlite3's driver honour attempting to run two concurrent manual (BEGIN) transactions, it will throw "cannot start a transaction within a transaction"
- Cannot use async code in BetterSqlite3's '.transaction' function (it halts immediately)

Essentially Sqlite is not designed for concurrency. It just locks the file, and leaves you to figure out. And the drivers aren't consistent. Annoyingly, Drizzle doesn't seem to be papering over the cracks (yet) - but presumably they will in the future.

Look under the `sql-research` directory and you'll see each of these points confirmed. 

# How it works 

For Postgres, it just uses Drizzle's transactions as normal. 

For Sqlite, it will run a custom transaction manually: 
- It issues a BEGIN, and then COMMIT/ROLLBACK depending on whether it succeeds
- If the BEGIN is blocked by a known concurrency error (e.g. "database is locked" or "cannot start a transaction within a transaction"), it will retry with jittery exponential back off 

It also attempts to initially use a global memory queue to run transactions sequentially. Which means you only need the jittery exponential back off if concurrent transactions are also coming from a different memory space. This means in most cases, it should execute the transactions in the correct order (and always the correct order for the code within a given memory space). 

Note: you may recognise this as an implementation of the "busy_timeout" switch (see https://www.sqlite.org/c3ref/busy_timeout.html)

# Usage

It's a drop in replacement for `db.transaction`. 

## For Postgres 
```typescript
import { drizzle as drizzlePg } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";

const client = new PGlite();
const db = drizzlePg(client);

// Replaces db.transaction(async (tx) => { /* ... */ })
robustTransaction('pg', db, (tx) => {/* ... */})

```

## For Sqlite

```typescript
import { drizzle as drizzleBetterSqlite} from 'drizzle-orm/better-sqlite3';
import Database from "better-sqlite3";

const url = `local.db`
const client = new Database(url);

// Replaces db.transaction(async (tx) => { /* ... */ })
robustTransaction('sqlite', db, (tx) => {/* ... */})

```

# The expectation is Drizzle will resolve this, and make it irrelevant

The tests under the `sql-research` directory are to set to fail if any of the above problems get fixed. 

In time you can either switch back to db.transactions, or update robustTransaction to rely on the parts that work.

# Is there a non-Drizzle version available? 

Not directly... Drizzle makes it too easy to handle multiple different drivers. 

But the logic in robustTransaction can easily be run with any specific driver. 
- Copy the robustTransaction function
- Replace every `db.run(sql.raw(/* sql, e.g. BEGIN */))` with the driver specific way to execute SQL 

# Further Discussion

- https://github.com/drizzle-team/drizzle-orm/issues/2275 
- https://github.com/tursodatabase/libsql-client-ts/issues/288 
- https://github.com/WiseLibs/better-sqlite3/blob/HEAD/docs/api.md#transactionfunction---function  