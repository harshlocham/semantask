import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    evaluateClassifierGold,
    type ClassifierEvalReport,
    type GoldFile,
} from "./classifier-eval.js";

export type { ClassifierEvalReport, GoldFile };
export { evaluateClassifierGold };

export function defaultGoldPath(): string {
    return join(dirname(fileURLToPath(import.meta.url)), "classifier-gold.json");
}

export function runClassifierEval(goldPath = defaultGoldPath()): ClassifierEvalReport {
    const gold = JSON.parse(readFileSync(goldPath, "utf8")) as GoldFile;
    return evaluateClassifierGold(gold);
}

const isMain =
    typeof process.argv[1] === "string"
    && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));

if (isMain || process.argv[1]?.endsWith("run-classifier-eval.ts")) {
    const report = runClassifierEval();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
    if (report.typeAccuracy < 0.7) {
        process.exitCode = 1;
    }
}
