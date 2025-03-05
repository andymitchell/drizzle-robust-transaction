
import { exponentialBackoffWithJitter } from "./expontentialBackoffWithJitter.ts"

test('basic', async () => {

    
    const result = await exponentialBackoffWithJitter(
        () => {
            return 1;
        }
    )

    expect(result).toBe(1);

})


test('backoff once', async () => {

    
    let attempts = 0;
    const result = await exponentialBackoffWithJitter(
        () => {
            if( attempts>0 ) {
                return 1;
            } 
            attempts++;
            throw new Error("Failed");
        }
    )

    expect(result).toBe(1);
    expect(attempts).toBe(1);

})


test('backoff max wait', async () => {

    
    let st = Date.now();
    let error: Error | undefined;
    let lastDuration = 0;
    try {
        await exponentialBackoffWithJitter(
            () => {
                lastDuration = Date.now()-st;
                throw new Error("Failed at ms: "+lastDuration);
            },
            {
                max_time_ms: 100
            }
        )
    } catch(e) {
        if( e instanceof Error ) error = e;
    }

    
    expect(!!error).toBe(true);
    expect(lastDuration).toBeLessThan(100);
    expect(lastDuration).toBeGreaterThan(30);
    

})


test('backoff max attempts', async () => {

    
    let st = Date.now();
    let error: Error | undefined;
    let lastDuration = 0;
    let attempts = 0;
    try {
        await exponentialBackoffWithJitter(
            () => {
                lastDuration = Date.now()-st;
                attempts++;
                throw new Error("Failed at ms: "+lastDuration);
            },
            {
                max_attempts: 4
            }
        )
    } catch(e) {
        if( e instanceof Error ) error = e;
    }

    
    expect(!!error).toBe(true);
    expect(attempts).toBe(4);
    expect(lastDuration).toBeLessThan(300);
    expect(lastDuration).toBeGreaterThan(70);
    

})


test('backoff white list allowed', async () => {

    
    let attempts = 0;
    const result = await exponentialBackoffWithJitter(
        () => {
            if( attempts>0 ) {
                return 1;
            } 
            attempts++;
            throw new Error("ABC");
        }, {
            whitelist_only_error_messages: [
                new RegExp('ABC')
            ]
        }
    )

    expect(result).toBe(1);
    expect(attempts).toBe(1);
    
    

})


test('backoff white list disallowed fails instantly', async () => {

    
    let attempts = 0;
    let error:Error | undefined;
    try {
        await exponentialBackoffWithJitter(
            () => {
                attempts++;
                throw new Error("DEF");
            }, {
                whitelist_only_error_messages: [
                    new RegExp('ABC')
                ]
            }
        )
    } catch(e) {
        if( e instanceof Error ) {
            error = e;
        }
    }

    expect(!!error).toBe(true);
    expect(attempts).toBe(1);
    expect(error!.message).toBe('DEF');
    
    

})