import {
    classifyMessage,
    classifyMessageWithRegex,
    configureMessageClassifier,
    getClassifierMode,
    isActionableClassification,
} from "../message-classifier.service";

const LABELED_MESSAGES: Array<{ content: string; expectType: string; actionable?: boolean }> = [
    { content: "send a welcome email to user@example.com", expectType: "task", actionable: true },
    { content: "create a github issue for the login bug", expectType: "task", actionable: true },
    { content: "can you fix the broken deploy script?", expectType: "task", actionable: true },
    { content: "schedule a meeting with the team tomorrow at 10am", expectType: "scheduling", actionable: true },
    { content: "please remind me to call John on Friday", expectType: "scheduling", actionable: true },
    { content: "production is down and users cannot log in", expectType: "incident", actionable: true },
    { content: "we have a critical bug in checkout", expectType: "incident", actionable: true },
    { content: "automate the nightly backup workflow", expectType: "automation", actionable: true },
    { content: "trigger the deployment pipeline script", expectType: "automation", actionable: true },
    { content: "please approve the release plan", expectType: "approval", actionable: false },
    { content: "this needs your sign-off before launch", expectType: "approval", actionable: false },
    { content: "escalate this to leadership immediately", expectType: "escalation", actionable: false },
    { content: "page the on-call team for urgent help", expectType: "escalation", actionable: false },
    { content: "hi there", expectType: "chat", actionable: false },
    { content: "thanks!", expectType: "chat", actionable: false },
    { content: "ok sounds good", expectType: "chat", actionable: false },
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

    test("regex classifier labels intent taxonomy samples", () => {
        let correct = 0;
        for (const sample of LABELED_MESSAGES) {
            const result = classifyMessageWithRegex(sample.content);
            if (result.semanticType === sample.expectType) {
                correct += 1;
            }
        }

        const accuracy = correct / LABELED_MESSAGES.length;
        expect(accuracy).toBeGreaterThanOrEqual(0.7);
    });

    test("isActionableClassification gates task creation intents", () => {
        const taskLike = classifyMessageWithRegex("send an email to the team");
        const approvalLike = classifyMessageWithRegex("please approve the release plan");

        expect(isActionableClassification(taskLike)).toBe(true);
        expect(isActionableClassification(approvalLike)).toBe(false);
    });

    test("llm mode falls back to regex when LLM fn is unavailable", async () => {
        const previousMode = process.env.TASK_CLASSIFIER_MODE;
        process.env.TASK_CLASSIFIER_MODE = "llm";
        configureMessageClassifier({ llmClassify: null });

        const result = await classifyMessage("send an email to the team");
        expect(result.source).toBe("regex");
        expect(result.semanticType).toBe("task");

        restoreEnvVar("TASK_CLASSIFIER_MODE", previousMode);
    });

    test("llm mode uses LLM result when available", async () => {
        const previousMode = process.env.TASK_CLASSIFIER_MODE;
        process.env.TASK_CLASSIFIER_MODE = "llm";
        configureMessageClassifier({
            llmClassify: async () => ({
                semanticType: "incident",
                confidence: 0.95,
                reasoning: "Mock LLM classified as incident",
                source: "llm",
            }),
        });

        const result = await classifyMessage("ambiguous phrase");
        expect(result.source).toBe("llm");
        expect(result.semanticType).toBe("incident");
        expect(result.confidence).toBe(0.95);

        restoreEnvVar("TASK_CLASSIFIER_MODE", previousMode);
    });

    test("shadow mode keeps regex authority and logs disagreement", async () => {
        const previousMode = process.env.TASK_CLASSIFIER_MODE;
        process.env.TASK_CLASSIFIER_MODE = "shadow";
        const disagreements: string[] = [];

        configureMessageClassifier({
            llmClassify: async () => ({
                semanticType: "chat",
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
        expect(result.semanticType).toBe("task");
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
