import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import ThemeSwitch from "@/components/home/theme-switch";

export default function ForgotPasswordPage() {
    return (
        <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 sm:px-6">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
                <div className="absolute -bottom-16 -left-10 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
            </div>

            <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
                <Card
                    className="w-full border-border/70 bg-card/94 shadow-2xl shadow-black/25 backdrop-blur-sm"
                    data-testid="forgot-password"
                >
                    <CardHeader className="gap-5">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold tracking-tight">Semantask</p>
                            <ThemeSwitch />
                        </div>
                        <div className="space-y-2">
                            <CardTitle className="max-w-sm text-3xl font-semibold leading-[1.05] tracking-tight sm:text-4xl">
                                Account recovery
                            </CardTitle>
                            <CardDescription className="max-w-md text-sm leading-6 sm:text-base">
                                Password reset is not available yet. New accounts verify with an
                                email one-time code. Sign in with the email and password you used
                                at register, or create a new account if you never finished
                                verification.
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent className="flex flex-col gap-3">
                        <Button asChild className="h-11 w-full">
                            <Link href="/login">Back to sign in</Link>
                        </Button>
                        <Button asChild variant="outline" className="h-11 w-full">
                            <Link href="/register">Create account</Link>
                        </Button>
                    </CardContent>

                    <CardFooter className="text-xs leading-6 text-muted-foreground">
                        Use the same email you verified. The one-time code is how we confirm it
                        is you.
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
