"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onGoogleSignIn = async () => {
    setBusy(true);
    setError(null);

    try {
      const origin = window.location.origin;
      await authClient.signIn.social({
        provider: "google",
        callbackURL: `${origin}/`,
        errorCallbackURL: `${origin}/sign-in`
      });
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Google sign-in failed. Check OAuth configuration."
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your Google account to access OpenClaw Hub.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <Alert className="border-destructive text-destructive">{error}</Alert> : null}
          <Button className="w-full" onClick={onGoogleSignIn} disabled={busy}>
            {busy ? "Redirecting..." : "Continue with Google"}
          </Button>
          <p className="text-xs text-muted-foreground">
            If this fails, verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and Google OAuth redirect URI.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
