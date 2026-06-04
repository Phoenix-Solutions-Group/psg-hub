"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [shopName, setShopName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [phone, setPhone] = useState("");

  async function handleSubmit() {
    setLoading(true);
    setError(null);

    // Shop + first-owner bootstrap runs server-side via the service-role onboarding
    // route: shop_users INSERT is RLS-blocked (with_check user_is_shop_owner) for a
    // brand-new shop, so it cannot run under the browser client.
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shopName,
        address,
        city,
        state,
        websiteUrl,
        phone,
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Setup failed. Please try again.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>
          {step === 1 && "Your shop"}
          {step === 2 && "Location"}
          {step === 3 && "Online presence"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">Step {step} of 3</p>
      </CardHeader>
      <CardContent>
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shop-name">Shop name</Label>
              <Input
                id="shop-name"
                placeholder="Tracy's Collision Center"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                required
              />
            </div>
            <Button
              className="w-full"
              onClick={() => setStep(2)}
              disabled={!shopName.trim()}
            >
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address">Street address</Label>
              <Input
                id="address"
                placeholder="1500 Center Park Rd"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  placeholder="Lincoln"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  placeholder="NE"
                  maxLength={2}
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="website">Website URL</Label>
              <Input
                id="website"
                placeholder="https://www.tracysbodyshop.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                placeholder="(402) 441-4800"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? "Setting up..." : "Complete setup"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
