"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ThemeSwitch from "@/components/home/theme-switch";
import {
    completeOnboarding,
    createOrganization,
    createOrganizationInvitation,
} from "@/lib/utils/api";
import { FORGOT_PASSWORD_PATH } from "@/lib/routes";

type Step = "workspace" | "invite";

export default function OnboardingPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>("workspace");
    const [orgName, setOrgName] = useState("");
    const [orgId, setOrgId] = useState<string | null>(null);
    const [inviteEmail, setInviteEmail] = useState("");
    const [loading, setLoading] = useState(false);

    async function finish() {
        setLoading(true);
        try {
            const { conversationId } = await completeOnboarding();
            router.push(`/c/${conversationId}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not open your first conversation");
            setLoading(false);
        }
    }

    async function handlePersonal() {
        await finish();
    }

    async function handleCreateOrg(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!orgName.trim()) {
            toast.error("Enter an organization name");
            return;
        }

        setLoading(true);
        try {
            const org = await createOrganization({ name: orgName.trim() });
            setOrgId(org.id);
            setStep("invite");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not create organization");
        } finally {
            setLoading(false);
        }
    }

    async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!orgId || !inviteEmail.trim()) {
            toast.error("Enter an email to invite");
            return;
        }

        setLoading(true);
        try {
            await createOrganizationInvitation(orgId, { email: inviteEmail.trim(), role: "member" });
            toast.success("Invite sent");
            await finish();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not send invite");
            setLoading(false);
        }
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 sm:px-6">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute right-0 top-12 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
                <div className="absolute -bottom-20 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
            </div>

            <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
                <Card
                    className="w-full border-border/70 bg-card/94 shadow-2xl shadow-black/25 backdrop-blur-sm"
                    data-testid="onboarding-wizard"
                >
                    <CardHeader className="gap-5">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold tracking-tight">Semantask</p>
                            <ThemeSwitch />
                        </div>
                        <div className="space-y-2">
                            <CardTitle className="max-w-sm text-3xl font-semibold leading-[1.05] tracking-tight sm:text-4xl">
                                {step === "workspace" ? "Set up your workspace" : "Invite a teammate"}
                            </CardTitle>
                            <CardDescription className="max-w-md text-sm leading-6 sm:text-base">
                                {step === "workspace"
                                    ? "Start personal, or create an organization. You can skip and still land in a conversation."
                                    : "Send one invite now, or skip and do this later."}
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent>
                        {step === "workspace" ? (
                            <div className="space-y-4">
                                <Button
                                    type="button"
                                    className="h-11 w-full"
                                    disabled={loading}
                                    data-testid="onboarding-personal"
                                    onClick={() => void handlePersonal()}
                                >
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Personal workspace
                                </Button>

                                <form className="space-y-3" onSubmit={handleCreateOrg}>
                                    <div className="grid gap-2">
                                        <Label htmlFor="onboarding-org-name">Organization name</Label>
                                        <Input
                                            id="onboarding-org-name"
                                            data-testid="onboarding-org-name"
                                            placeholder="Acme"
                                            value={orgName}
                                            onChange={(e) => setOrgName(e.target.value)}
                                            disabled={loading}
                                        />
                                    </div>
                                    <Button
                                        type="submit"
                                        variant="outline"
                                        className="h-11 w-full"
                                        disabled={loading || !orgName.trim()}
                                        data-testid="onboarding-create-org"
                                    >
                                        Create organization
                                    </Button>
                                </form>

                                <Button
                                    type="button"
                                    variant="link"
                                    className="h-auto w-full px-0"
                                    disabled={loading}
                                    data-testid="onboarding-skip"
                                    onClick={() => void finish()}
                                >
                                    Skip for now
                                </Button>
                            </div>
                        ) : (
                            <form className="space-y-4" onSubmit={handleInvite}>
                                <div className="grid gap-2">
                                    <Label htmlFor="onboarding-invite-email">Teammate email</Label>
                                    <Input
                                        id="onboarding-invite-email"
                                        type="email"
                                        data-testid="onboarding-invite-email"
                                        placeholder="alex@example.com"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        disabled={loading}
                                    />
                                </div>
                                <Button
                                    type="submit"
                                    className="h-11 w-full"
                                    disabled={loading || !inviteEmail.trim()}
                                    data-testid="onboarding-invite-send"
                                >
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Send invite
                                </Button>
                                <Button
                                    type="button"
                                    variant="link"
                                    className="h-auto w-full px-0"
                                    disabled={loading}
                                    data-testid="onboarding-skip-invite"
                                    onClick={() => void finish()}
                                >
                                    Skip invite
                                </Button>
                            </form>
                        )}
                    </CardContent>

                    <CardFooter className="text-xs leading-6 text-muted-foreground">
                        Account recovery uses the email OTP on this address.{" "}
                        <a href={FORGOT_PASSWORD_PATH} className="underline underline-offset-2">
                            How recovery works
                        </a>
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
