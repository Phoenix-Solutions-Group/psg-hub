"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LinkAccountButton } from "./link-account-button";
import { canDisconnect, type ShopRole } from "@/lib/ads/view-state";

type Account = {
  id: string;
  customer_id: string;
  status: "linked" | "revoked" | "error";
  linked_at: string;
  last_error: string | null;
};

type Props = {
  accounts: Account[];
  shopId: string;
  userRole: ShopRole;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusBadge(status: Account["status"]) {
  if (status === "linked") {
    return <Badge className="bg-green-100 text-green-800">Linked</Badge>;
  }
  if (status === "revoked") {
    return <Badge variant="secondary">Revoked</Badge>;
  }
  return <Badge className="bg-red-100 text-red-800">Error</Badge>;
}

export function AccountsTable({ accounts, shopId, userRole }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const existingCustomerIds = accounts.map((a) => a.customer_id);

  function handleDisconnect(accountId: string, customerId: string) {
    const confirmed = window.confirm(
      `Disconnect customer ${customerId}? This revokes the OAuth link at Google.`
    );
    if (!confirmed) return;

    setErrorMessage(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/ads/google/accounts/${accountId}/disconnect`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(
          typeof data.error === "string"
            ? data.error
            : `Disconnect failed (${res.status})`
        );
        return;
      }
      router.refresh();
    });
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-md border p-8">
        <p className="text-sm text-muted-foreground">
          No Google Ads account linked yet.
        </p>
        <div className="mt-4">
          <LinkAccountButton
            shopId={shopId}
            userRole={userRole}
            existingCustomerIds={[]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Linked accounts</h2>
        </div>
        <LinkAccountButton
          shopId={shopId}
          userRole={userRole}
          existingCustomerIds={existingCustomerIds}
        />
      </div>

      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Linked</TableHead>
            <TableHead>Last error</TableHead>
            {canDisconnect(userRole) && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-mono text-sm">
                {a.customer_id}
              </TableCell>
              <TableCell>{statusBadge(a.status)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(a.linked_at)}
              </TableCell>
              <TableCell className="max-w-xs text-sm text-muted-foreground">
                {a.last_error || "—"}
              </TableCell>
              {canDisconnect(userRole) && (
                <TableCell>
                  {a.status === "linked" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => handleDisconnect(a.id, a.customer_id)}
                      aria-label={`Disconnect customer ${a.customer_id}`}
                    >
                      Disconnect
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
