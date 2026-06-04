"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ApprovalActions({ contentId }: { contentId: string }) {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  async function handleAction(action: "approve" | "reject") {
    setLoading(action);
    const res = await fetch(`/api/content/${contentId}/${action}`, {
      method: "POST",
    });

    if (res.ok) {
      router.refresh();
    }
    setLoading(null);
  }

  return (
    <div className="flex gap-3">
      <Button
        onClick={() => handleAction("approve")}
        disabled={loading !== null}
        className="bg-green-600 hover:bg-green-700"
      >
        {loading === "approve" ? "Approving..." : "Approve"}
      </Button>
      <Button
        variant="outline"
        onClick={() => handleAction("reject")}
        disabled={loading !== null}
        className="border-red-300 text-red-600 hover:bg-red-50"
      >
        {loading === "reject" ? "Rejecting..." : "Reject"}
      </Button>
    </div>
  );
}
