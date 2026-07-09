import {
    classifyMessage,
    classifyMessageWithRegex,
    configureMessageClassifier,
    getClassifierMode,
    isTaskClassification,
} from "../message-classifier.service";

const LABELED_MESSAGES: Array<{ content: string; expectTask: boolean }> = [
    { content: "send a welcome email to user@example.com", expectTask: true },
    { content: "schedule a meeting with the team tomorrow at 10am", expectTask: true },
    { content: "create a github issue for the login bug", expectTask: true },
    { content: "please remind me to call John on Friday", expectTask: true },
    { content: "can you fix the broken deploy script?", expectTask: true },
    { content: "hi there", expectTask: false },
    { content: "thanks!", expectTask: false },
    { content: "ok sounds good", expectTask: false },
    { content: "lol", expectTask: false },
    { content: "good morning everyone", expectTask: false },
];

function restoreEnvVar(key: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }

    process.env[key] = value;
}

describe("message-classifier.service", () => {
    afterEach(() => {
        configureMessageClassifier({ llmClassify: null, onDisagreement: null });
    });

    test("regex classifier labels common task and chat messages", () => {
        let correct = 0;
        for (const sample of LABELED_MESSAGES) {
            const result = classifyMessageWithRegex(sample.content);
            const predictedTask = isTaskClassification(result);
            if (predictedTask === sample.expectTask) {
                correct += 1;
            }
        }

        const accuracy = correct / LABELED_MESSAGES.length;
        expect(accuracy).toBeGreaterThanOrEqual(0.8);
    });

    test("llm mode falls back to regex when LLM fn is unavailable", async () => {
        const previousMode = process.env.TASK_CLASSIFIER_MODE;
        process.env.TASK_CLASSIFIER_MODE = "llm";
        configureMessageClassifier({ llmClassify: null });

        const result = await classifyMessage("send an email to the team");
        expect(result.source).toBe("regex");
        expect(isTaskClassification(result)).toBe(true);

        restoreEnvVar("TASK_CLASSIFIER_MODE", previousMode);
    });

    test("llm mode uses LLM result when available", async () => {
        const previousMode = process.env.TASK_CLASSIFIER_MODE;
        process.env.TASK_CLASSIFIER_MODE = "llm";
        configureMessageClassifier({
            llmClassify: async () => ({
                isTask: true,
                confidence: 0.95,
                reasoning: "Mock LLM classified as task",
                source: "llm",
            }),
        });

        const result = await classifyMessage("ambiguous phrase");
        expect(result.source).toBe("llm");
        expect(result.confidence).toBe(0.95);

        restoreEnvVar("TASK_CLASSIFIER_MODE", previousMode);
    });

    test("shadow mode keeps regex authority and logs disagreement", async () => {
        const previousMode = process.env.TASK_CLASSIFIER_MODE;
        process.env.TASK_CLASSIFIER_MODE = "shadow";
        const disagreements: string[] = [];

        configureMessageClassifier({
            llmClassify: async () => ({
                isTask: false,
                confidence: 0.9,
                reasoning: "Mock LLM says chat",
                source: "llm",
            }),
            onDisagreement: (payload) => {
                disagreements.push(payload.contentPreview);
            },
        });

        const result = await classifyMessage("send a welcome email to user@example.com");
        expect(result.source).toBe("regex");
        expect(isTaskClassification(result)).toBe(true);
        expect(disagreements.length).toBe(1);

        restoreEnvVar("TASK_CLASSIFIER_MODE", previousMode);
    });

    test("getClassifierMode defaults to regex", () => {
        const previous = process.env.TASK_CLASSIFIER_MODE;
        delete process.env.TASK_CLASSIFIER_MODE;
        expect(getClassifierMode()).toBe("regex");
        restoreEnvVar("TASK_CLASSIFIER_MODE", previous);
    });
});
