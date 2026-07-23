export class ValidationError extends Error {
    readonly code = "VALIDATION_ERROR" as const;

    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
    }
}

/** Map organization API catch errors to HTTP status (auth handled separately). */
export function organizationApiErrorStatus(error: unknown): number {
    if (error instanceof ValidationError) {
        return 400;
    }
    // Mongoose schema validation (e.g. runValidators: true on quota upsert).
    if (error instanceof Error && error.name === "ValidationError") {
        return 400;
    }
    return 500;
}
