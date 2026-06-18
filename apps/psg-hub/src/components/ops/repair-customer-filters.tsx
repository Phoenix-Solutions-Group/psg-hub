"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Search + company filter bar for the Repair Customers list (v1.1 / PSG-34).
// Navigates via the URL so the server component owns querying/sorting.
type CompanyOption = { id: string; name: string };

export function RepairCustomerFilters({
  companies,
  q,
  companyId,
}: {
  companies: CompanyOption[];
  q: string;
  companyId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const [company, setCompany] = useState(companyId);

  function apply(nextSearch: string, nextCompany: string) {
    const params = new URLSearchParams();
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    if (nextCompany) params.set("company_id", nextCompany);
    const qs = params.toString();
    router.push(qs ? `/ops/repair-customers?${qs}` : "/ops/repair-customers");
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(search, company);
      }}
    >
      <Input
        placeholder="Search name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />
      <select
        value={company}
        onChange={(e) => {
          setCompany(e.target.value);
          apply(search, e.target.value);
        }}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm"
      >
        <option value="">All companies</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline">
        Search
      </Button>
      {(q || companyId) && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setSearch("");
            setCompany("");
            router.push("/ops/repair-customers");
          }}
        >
          Clear
        </Button>
      )}
    </form>
  );
}
