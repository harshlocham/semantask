export class AuthorizationError extends Error {
    readonly code: "FORBIDDEN" | "NOT_FOUND";

    constructor(code: "FORBIDDEN" | "NOT_FOUND", message: string) {
        super(message);
        this.name = "AuthorizationError";
        this.code = code;
    }
}
