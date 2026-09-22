import Link from "next/link";
import { Button } from "@/components/ui/button";
import ThemeSwitch from "@/components/home/theme-switch";

const STEPS = [
    {
        title: "Teams talk",
        body: "Work starts in conversation — the same thread people already use.",
    },
    {
        title: "Work is extracted for review",
        body: "Semantask turns what was said into suggestions you can accept or dismiss.",
    },
    {
        title: "A manager approves when policy requires it",
        body: "Autonomy is optional. Suggest-first is the default; tools run only when you allow them.",
    },
] as const;

export default function LandingPage() {
    return (
        <main
            className="relative min-h-dvh overflow-hidden bg-background px-4 py-8 sm:px-6"
            data-testid="product-landing"
        >
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
                <div className="absolute -bottom-16 -left-10 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
            </div>

            <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-12 py-6 sm:py-16">
                <header className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold tracking-tight text-foreground">Semantask</p>
                    <ThemeSwitch />
                </header>

                <section className="space-y-6">
                    <h1 className="max-w-xl text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
                        Conversation that becomes reviewable work
                    </h1>
                    <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                        Teams talk, work is extracted for review, and a manager approves when
                        policy requires it. Autonomy is optional.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button asChild className="h-11 px-5">
                            <Link href="/register">Create account</Link>
                        </Button>
                        <Button asChild variant="outline" className="h-11 px-5">
                            <Link href="/login">Sign in</Link>
                        </Button>
                    </div>
                </section>

                <ol
                    className="grid gap-4 sm:grid-cols-3"
                    data-testid="landing-promise"
                    aria-label="How Semantask works"
                >
                    {STEPS.map((step, index) => (
                        <li
                            key={step.title}
                            className="rounded-xl border border-border/70 bg-card/94 p-5 shadow-sm"
                        >
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                Step {index + 1}
                            </p>
                            <h2 className="mt-2 text-base font-semibold text-foreground">{step.title}</h2>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
                        </li>
                    ))}
                </ol>
            </div>
        </main>
    );
}
