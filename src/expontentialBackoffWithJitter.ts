import { sleep } from "@andyrmitchell/utils";

// TODO Move me to @andyrmitchell/utils

type Options = {
    max_time_ms?: number,
    max_attempts?: number,
    whitelist_only_error_messages?: RegExp[] | null,
    verbose?: boolean
}

export async function exponentialBackoffWithJitter<T> (
    task: () => T | Promise<T>,
    options?: Options
): Promise<T> {
    let attempt = 0;
    const baseDelay = 10; // Minimum base delay in milliseconds
    const maxDelay = 1000; // Maximum delay for a single attempt in milliseconds

    const finalOptions:Required<Options> = {
        max_attempts: 10000,
        max_time_ms: 5000,
        whitelist_only_error_messages: null,
        verbose: false,
        ...options
    }


    const startTime = Date.now();
    let lastError:Error | undefined;

    while (attempt < finalOptions.max_attempts) {
        try {
            const result = await task();
            return result; // Exit if the task succeeds
        } catch (error) {
            if( error instanceof Error ) {
                // Things like Drizzle will sometimes return the actual database error as 'cause', which contains the whitelist text to check.
                let errorString = error.message;
                let traversableError = error;
                while(traversableError.cause instanceof Error) {
                    traversableError = traversableError.cause;
                    errorString += `\n${traversableError.message}`;
                }

                if( finalOptions.verbose ) console.log("Error detected: ", errorString);

                lastError = error;

                if( finalOptions.whitelist_only_error_messages ) {
                    if( !finalOptions.whitelist_only_error_messages.some(x => x.test(errorString)) ) {
                        // Did not pass the whitelist
                        throw error;
                    }
                }
            }
            attempt++;

            // Calculate the delay with exponential backoff and jitter
            const delay = Math.min(
                getJitteredDelay(baseDelay * 2 ** attempt),
                maxDelay
            );

            const elapsed = Date.now() - startTime;
            if (elapsed + delay > finalOptions.max_time_ms) {
                if( finalOptions.verbose ) console.log("Exceeded maximum allowed time for backoff");
                throw error;
            }


            if( finalOptions.verbose ) console.log(`Waiting for ${delay}ms before retrying...`);
            await sleep(delay);
        }
    }

    if( !lastError ) lastError = new Error("Task failed after maximum attempts");
    throw lastError;
};

const getJitteredDelay = (delay: number): number => {
    const jitter = Math.random() * delay;
    return delay / 2 + jitter; // Random delay between `delay/2` and `delay`
};