"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trackBsmPilotEvent } from "@/lib/bsm/pilot-events-client";

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryNote, setDiscoveryNote] = useState<string | null>(null);
  const [pendingFields, setPendingFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [shopName, setShopName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [phone, setPhone] = useState("");
  const trackedOpenRef = useRef(false);

  useEffect(() => {
    if (trackedOpenRef.current) return;
    trackedOpenRef.current = true;
    void trackBsmPilotEvent("setup_started");
  }, []);

  // PSG-144 smart auto-discovery: name + address -> suggested profile fields.
  // Suggestions are pre-filled but always editable; the user confirms before the
  // shop is created (verified-facts mandate — nothing is asserted as truth here).
  async function handleDiscover() {
    setDiscovering(true);
    setError(null);
    setDiscoveryNote(null);
    try {
      const res = await fetch("/api/onboarding/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shopName, address, city, state }),
      });
      if (res.ok) {
        const { profile } = (await res.json()) as {
          profile: {
            websiteUrl: { value: string | null };
            phone: { value: string | null };
            pending: string[];
          };
        };
        // Only pre-fill empty fields so we never clobber what the user typed.
        if (profile.websiteUrl.value && !websiteUrl) {
          setWebsiteUrl(profile.websiteUrl.value);
        }
        if (profile.phone.value && !phone) setPhone(profile.phone.value);
        setPendingFields(profile.pending ?? []);
        setDiscoveryNote("Review the suggestions below and edit anything.");
      } else {
        setDiscoveryNote("Couldn't auto-fill — enter your details below.");
      }
    } catch {
      setDiscoveryNote("Couldn't auto-fill — enter your details below.");
    } finally {
      setDiscovering(false);
      setStep(3);
    }
  }

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

    await fetch("/api/onboarding/audit", { method: "POST" }).catch(() => null);
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
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleDiscover}
              disabled={discovering || !shopName.trim()}
            >
              {discovering ? "Finding your shop..." : "Find my shop & auto-fill"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              We&apos;ll suggest your website and details from your name and
              address. You can edit everything before finishing.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {discoveryNote && (
              <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
                <p>{discoveryNote}</p>
                {pendingFields.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    We&apos;ll auto-fill {pendingFields.join(", ")} once your data
                    sources are connected.
                  </p>
                )}
              </div>
            )}
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
