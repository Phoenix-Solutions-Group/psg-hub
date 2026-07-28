import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { NewCompanyForm } from "@/components/ops/new-company-form";
import { filterCompaniesByWord } from "@/lib/ops/company-search";

type CompanyRow = {
  id: string;
  name: string;
  phone: string | null;
  contact: string | null;
  status: string;
};

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export default async function CompaniesPage({ searchParams }: Props) {
  const { q: rawQuery } = await searchParams;
  const query = (rawQuery ?? "").trim();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  // Module-level gate: the /ops shell admits all staff, but Companies needs the
  // manage_companies capability. Fail closed with an in-shell notice.
  if (!hasOpsFn(access, "manage_companies")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Companies</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_companies</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const { data } = await service
    .from("companies")
    .select("id, name, phone, contact, status")
    .order("name", { ascending: true })
    .limit(500);
  const allCompanies = (data ?? []) as CompanyRow[];
  const companies = filterCompaniesByWord(allCompanies, query);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {query ? `${companies.length} matching ${allCompanies.length} on file` : `${allCompanies.length} on file`}
          </p>
        </div>
      </div>

      <NewCompanyForm />

      <form action="/ops/companies" className="rounded-lg border border-border p-4">
        <label className="text-sm font-medium" htmlFor="companies-search">
          Search companies by shop name or full words
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="companies-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search Collision, Wallace, Tedesco, contact, phone"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 font-heading text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Search
          </button>
          {query ? (
            <Link
              href="/ops/companies"
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 font-heading text-sm font-medium hover:bg-muted"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  {query
                    ? "No companies match that search. Try a shop name such as Collision, Wallace, or Tedesco."
                    : "No companies yet. Add the first one above."}
                </td>
              </tr>
            ) : (
              companies.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link href={`/ops/companies/${c.id}`} className="font-medium hover:text-ember">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.contact ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
