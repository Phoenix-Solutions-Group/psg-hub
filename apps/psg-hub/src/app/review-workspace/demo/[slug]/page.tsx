import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RIVERSIDE_REPUTATION_POST_SLUG = "riverside-august-reputation-post";

export default async function DemoReviewPreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (slug !== RIVERSIDE_REPUTATION_POST_SLUG) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6 flex items-center gap-3">
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
          Draft preview
        </span>
        <span className="text-sm text-muted-foreground">Private customer review</span>
      </div>

      <article className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <header className="space-y-2">
          <p className="text-sm font-medium text-ember">Riverside Collision</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            A repair you can feel confident about
          </h1>
        </header>

        <p className="leading-7 text-foreground/90">
          Choosing a collision repair shop is about more than restoring how a vehicle looks. Riverside
          Collision follows the repair plan, keeps customers informed, and checks the completed work
          before the vehicle is returned.
        </p>

        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold">What customers can expect</h2>
          <ul className="list-disc space-y-2 pl-6 text-foreground/90">
            <li>A clear explanation of the planned repair.</li>
            <li>Updates when the repair schedule or scope changes.</li>
            <li>A final review of the completed work before pickup.</li>
          </ul>
        </section>

        <p className="leading-7 text-foreground/90">
          If your vehicle has collision damage, contact Riverside Collision to discuss an estimate and
          the next steps for your repair.
        </p>
      </article>
    </main>
  );
}
