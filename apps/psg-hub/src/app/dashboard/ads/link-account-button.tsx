"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  canLinkAccount,
  type ShopRole,
} from "@/lib/ads/view-state";

const POLL_INTERVAL_MS = 3_000;
const TIMEOUT_MS = 5 * 60 * 1000;

type Props = {
  shopId: string;
  userRole: ShopRole;
  existingCustomerIds: string[];
};

export function LinkAccountButton({
  shopId,
  userRole,
  existingCustomerIds,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageListenerRef = useRef<
    ((e: MessageEvent) => void) | null
  >(null);
  const popupRef = useRef<Window | null>(null);
  const cancelledRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (messageListenerRef.current) {
      window.removeEventListener("message", messageListenerRef.current);
      messageListenerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopPolling();
    };
  }, [stopPolling]);

  if (!canLinkAccount(userRole)) {
    return (
      <p className="text-sm text-muted-foreground">
        Only owners can link ad accounts.
      </p>
    );
  }

  async function handleClick() {
    setErrorMessage(null);
    setPopupBlockedUrl(null);
    setPending(true);

    let authorizeRes: Response;
    try {
      authorizeRes = await fetch("/api/ads/google/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
    } catch {
      setErrorMessage("Network error. Try again.");
      setPending(false);
      return;
    }

    if (!authorizeRes.ok) {
      const data = await authorizeRes.json().catch(() => ({}));
      const message =
        typeof data.error === "string"
          ? data.error
          : `Authorize failed (${authorizeRes.status})`;
      setErrorMessage(message);
      setPending(false);
      return;
    }

    const { url } = (await authorizeRes.json()) as { url: string };

    const popup = window.open(url, "google-ads-auth", "width=600,height=700");
    if (!popup) {
      setPopupBlockedUrl(url);
      setPending(false);
      return;
    }
    popupRef.current = popup;

    const snapshot = new Set(existingCustomerIds);
    const startedAt = Date.now();

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string } | null;
      if (data?.type === "google-ads-linked") {
        stopPolling();
        if (popupRef.current && !popupRef.current.closed) {
          popupRef.current.close();
        }
        if (!cancelledRef.current) {
          setPending(false);
          router.refresh();
        }
      }
    };
    messageListenerRef.current = handleMessage;
    window.addEventListener("message", handleMessage);

    intervalRef.current = setInterval(async () => {
      if (cancelledRef.current) {
        stopPolling();
        return;
      }

      if (Date.now() - startedAt > TIMEOUT_MS) {
        stopPolling();
        if (!cancelledRef.current) {
          setPending(false);
          setErrorMessage(
            "If you completed the link, refresh the page."
          );
        }
        return;
      }

      if (popupRef.current?.closed) {
        stopPolling();
        if (!cancelledRef.current) {
          setPending(false);
        }
        return;
      }

      try {
        const res = await fetch(
          `/api/ads/google/accounts?shop_id=${encodeURIComponent(shopId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          accounts: Array<{ customer_id: string; status: string }>;
        };
        const newLinked = data.accounts.find(
          (a) => !snapshot.has(a.customer_id) && a.status === "linked"
        );
        if (newLinked) {
          stopPolling();
          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
          }
          if (!cancelledRef.current) {
            setPending(false);
            router.refresh();
          }
        }
      } catch {
        // transient network error; keep polling
      }
    }, POLL_INTERVAL_MS);
  }

  if (popupBlockedUrl) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive" role="alert">
          Your browser blocked the popup.
        </p>
        <a
          href={popupBlockedUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          Open Google sign-in in new tab
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={pending}>
        {pending ? "Waiting for Google…" : "Link Google Ads"}
      </Button>
      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
