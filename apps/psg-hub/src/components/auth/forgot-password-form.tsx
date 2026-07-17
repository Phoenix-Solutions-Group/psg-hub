"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      // Recovery link returns through our callback, which establishes the
      // recovery session and forwards to the set-new-password screen.
      redirectTo: `${window.location.origin}/auth/callback?type=recovery&next=/reset-password`,
    });

    if (authError) {
      setError(friendlyAuthError(authError));
      setLoading(false);
      return;
    }

    // Always show success — we don't reveal whether an account exists.
    setSentTo(email);
    setLoading(false);
  }

  if (sentTo) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6 text-center">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Check your email
          </h2>
          <p className="text-sm text-muted-foreground">
            If an account exists for{" "}
            <span className="font-medium text-foreground">{sentTo}</span>, we&apos;ve
            sent a link to reset your password. Open it to choose a new one.
          </p>
          <p className="pt-2 text-sm text-muted-foreground">
            <a href="/login" className="font-medium text-primary hover:text-ember">
              Back to sign in
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
