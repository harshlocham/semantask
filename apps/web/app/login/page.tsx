'use client';

import { useRouter } from 'next/navigation';
import React, { Suspense } from 'react';
import { resetAuthBootstrap } from "@/lib/auth/authBootstrap";
import { useUser } from "@/context/UserContext";
import { Input } from '@/components/ui/input';
import { Button } from "@/components/ui/button"
import ThemeSwitch from "@/components/home/theme-switch";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { APP_HOME } from "@/lib/routes";
import { Loader2 } from "lucide-react";
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

function AuthErrorWarning() {
    const searchParams = useSearchParams();

    useEffect(() => {
        const error = searchParams.get("error");
        if (error === "google_oauth_unavailable") {
            toast.error("Google sign-in is not configured for this environment.");
        }
    }, [searchParams]);

    return null;
}

function Loginpage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const router = useRouter();
    const { refreshUser } = useUser();
    const [pendingAction, setPendingAction] = useState<"credentials" | "google" | null>(null);

    const isCredentialsLoading = pendingAction === "credentials";
    const isGoogleLoading = pendingAction === "google";
    const isLoading = pendingAction !== null;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setPendingAction("credentials");

        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: email.trim(),
                    password,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || "Login failed");
            }

            resetAuthBootstrap();
            const me = await refreshUser();
            if (!me) {
                throw new Error("Session could not be loaded. Try again.");
            }

            toast.success("Welcome back");
            router.push(APP_HOME);
        } catch (error: unknown) {
            if (error instanceof Error) {
                toast.error(error.message);
            } else {
                toast.error("An unknown error occurred.");
            }
        } finally {
            setPendingAction(null);
        }
    }

    return (
        <>
            <Suspense fallback={null}>
                <AuthErrorWarning />
            </Suspense>
            <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 sm:px-6">
                <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
                    <div className="absolute -bottom-16 -left-10 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
                </div>

                <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
                    <Card className="w-full border-border/70 bg-card/94 shadow-2xl shadow-black/25 backdrop-blur-sm">
                        <CardHeader className="gap-5">
                            <div className="flex items-center justify-between gap-3">
                                <div className="rounded-md border border-border bg-background/45 px-3 py-1.5 text-sm text-muted-foreground">
                                    New here?
                                    <Button
                                        variant="link"
                                        className="h-auto px-2 py-0 text-sm font-medium"
                                        onClick={() => router.push("/register")}
                                    >
                                        Create account
                                    </Button>
                                </div>
                                <ThemeSwitch />
                            </div>

                            <div className="space-y-2">
                                <CardTitle className="max-w-sm text-3xl font-semibold leading-[1.05] tracking-tight sm:text-4xl">
                                    Welcome back
                                </CardTitle>
                                <CardDescription className="max-w-md text-sm leading-6 sm:text-base">
                                    Sign in to open your workspace and review extracted work.
                                </CardDescription>
                            </div>
                        </CardHeader>

                        <CardContent>
                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div className="grid gap-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="you@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        autoComplete="email"
                                        className="h-11"
                                        required
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="password">Password</Label>
                                        <Button
                                            type="button"
                                            variant="link"
                                            className="h-auto px-0 text-xs"
                                            onClick={() => router.push("/forgot-password")}
                                        >
                                            Forgot password?
                                        </Button>
                                    </div>
                                    <Input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoComplete="current-password"
                                        className="h-11"
                                        required
                                        disabled={isLoading}
                                    />
                                </div>

                                <Button
                                    type="submit"
                                    className="h-11 w-full"
                                    disabled={isLoading || !email.trim() || !password.trim()}
                                >
                                    {isCredentialsLoading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    {isCredentialsLoading ? "Logging in..." : "Login"}
                                </Button>
                            </form>
                        </CardContent>

                        <CardFooter className="flex-col gap-3">
                            <div className="flex w-full items-center gap-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                <span className="h-px flex-1 bg-border" />
                                <span>or</span>
                                <span className="h-px flex-1 bg-border" />
                            </div>

                            <Button
                                variant="outline"
                                className="h-11 w-full"
                                onClick={async () => {
                                    try {
                                        setPendingAction("google");
                                        window.location.href = `/api/auth/google/start?callbackUrl=${APP_HOME}`;
                                    } catch (error) {
                                        if (error instanceof Error) {
                                            toast.error(error.message);
                                        } else {
                                            toast.error("Google sign-in failed.");
                                        }
                                        setPendingAction(null);
                                    }
                                }}
                                disabled={isLoading}
                            >
                                {isGoogleLoading ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                {isGoogleLoading ? "Connecting Google..." : "Continue with Google"}
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            </div>
        </>
    )
}
export default Loginpage;