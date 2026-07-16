import type { MessageSemanticType } from "@semantask/types";
import type { WorkflowTemplate } from "./workflow-template.js";

/**
 * Resolves a {@link WorkflowTemplate} for a given semantic type. Templates are
 * consulted in registration order; the default template (registered as the
 * fallback) handles anything no specialized template claims.
 */
export class WorkflowRegistry {
    private readonly templates: WorkflowTemplate[] = [];

    constructor(private readonly defaultTemplate: WorkflowTemplate) {}

    /** Register a specialized template. Order matters: first match wins. */
    register(template: WorkflowTemplate): this {
        this.templates.push(template);
        return this;
    }

    /**
     * Return the first registered template that supports `semanticType`, falling
     * back to the default template when none match.
     */
    resolve(semanticType?: MessageSemanticType | null): WorkflowTemplate {
        for (const template of this.templates) {
            if (template.supports(semanticType)) {
                return template;
            }
        }
        return this.defaultTemplate;
    }
}
