"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // When email confirmation is ON, sign-up returns no session. Instead of a
  // blind redirect to /dashboard (which the auth gate bounces to /login — the
  // dead end this ticket fixes), we show a "check your email" state.
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Those passwords don't match. Please re-enter them.");
      return;
    }

    if (password.length < 8) {
      setError("Please use a password of at least 8 characters.");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Confirmation link comes back through our callback, which exchanges the
        // code for a session and then forwards into onboarding.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });

    if (authError) {
      setError(friendlyAuthError(authError));
      setLoading(false);
      return;
    }

    // Email-confirm OFF → a session is returned → straight into onboarding.
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    // Email-confirm ON → no session → show the confirmation-pending screen.
    setConfirmationSentTo(email);
    setLoading(false);
  }

  async function handleResend() {
    if (!confirmationSentTo) return;
    setResendState("sending");
    const supabase = createClient();
    await supabase.auth.resend({
      type: "signup",
      email: confirmationSentTo,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    // Always report "sent" — we don't reveal whether the address is registered.
    setResendState("sent");
  }

  if (confirmationSentTo) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6 text-center">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Almost there — check your email
          </h2>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground">{confirmationSentTo}</span>.
            Click it to activate your account and start setting up your shop.
          </p>
          <div className="pt-2 text-sm text-muted-foreground">
            {resendState === "sent" ? (
              <span>Sent again — please give it a minute and check your spam folder.</span>
            ) : (
              <span>
                Didn&apos;t get it?{" "}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendState === "sending"}
                  className="font-medium text-primary hover:text-ember disabled:opacity-60"
                >
                  {resendState === "sending" ? "Resending..." : "Resend email"}
                </button>
              </span>
            )}
          </div>
          <p className="pt-2 text-sm text-muted-foreground">
            Already confirmed?{" "}
            <a href="/login" className="font-medium text-primary hover:text-ember">
              Sign in
            </a>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
