"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authenticatedFetch } from "@/lib/utils/api";

export default function AccountPage() {
    const router = useRouter();
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [changing, setChanging] = useState(false);
    const [revoking, setRevoking] = useState(false);
    const [revokeError, setRevokeError] = useState<string | null>(null);

    async function changePassword() {
        setPasswordMessage(null);
        setPasswordError(null);
        if (newPassword.length < 8) {
            setPasswordError("New password must be at least 8 characters.");
            return;
        }
        setChanging(true);
        try {
            const response = await authenticatedFetch("/api/auth/change-password", {
                method: "POST",
                body: JSON.stringify({ oldPassword, newPassword }),
            });
            const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
            if (!response.ok) {
                setPasswordError(payload?.error || payload?.message || "Could not change password.");
                return;
            }
            setOldPassword("");
            setNewPassword("");
            setPasswordMessage("Password updated. Sign in again.");
            router.replace("/login");
        } catch (error) {
            setPasswordError(error instanceof Error ? error.message : "Could not change password.");
        } finally {
            setChanging(false);
        }
    }

    async function revokeSessions() {
        setRevokeError(null);
        setRevoking(true);
        try {
            const response = await authenticatedFetch("/api/auth/revoke-all-tokens", {
                method: "POST",
            });
            const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
            if (!response.ok) {
                setRevokeError(payload?.error || payload?.message || "Could not revoke sessions.");
                setRevoking(false);
                return;
            }
            router.replace("/login");
        } catch (error) {
            setRevokeError(error instanceof Error ? error.message : "Could not revoke sessions.");
            setRevoking(false);
        }
    }

    return (
        <div className="mx-auto max-w-xl space-y-6" data-testid="account-security">
            <Card>
                <CardHeader>
                    <CardTitle>Change password</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="account-old-password">Current password</Label>
                        <Input
                            id="account-old-password"
                            type="password"
                            autoComplete="current-password"
                            data-testid="account-old-password"
                            value={oldPassword}
                            onChange={(event) => setOldPassword(event.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="account-new-password">New password</Label>
                        <Input
                            id="account-new-password"
                            type="password"
                            autoComplete="new-password"
                            data-testid="account-new-password"
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                        />
                    </div>
                    {passwordError ? (
                        <p className="text-sm text-destructive" data-testid="account-password-error">
                            {passwordError}
                        </p>
                    ) : null}
                    {passwordMessage ? (
                        <p className="text-sm text-foreground" data-testid="account-password-message">
                            {passwordMessage}
                        </p>
                    ) : null}
                    <Button
                        type="button"
                        data-testid="account-change-password"
                        disabled={changing || !oldPassword || !newPassword}
                        onClick={() => void changePassword()}
                    >
                        {changing ? "Updating…" : "Change password"}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Sessions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Revoke every signed-in session, including this one. You will need to sign in again.
                    </p>
                    {revokeError ? (
                        <p className="text-sm text-destructive" data-testid="account-revoke-error">
                            {revokeError}
                        </p>
                    ) : null}
                    <Button
                        type="button"
                        variant="outline"
                        data-testid="account-revoke-sessions"
                        disabled={revoking}
                        onClick={() => void revokeSessions()}
                    >
                        {revoking ? "Revoking…" : "Revoke all sessions"}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
