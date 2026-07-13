"use client";

import { FormEvent, useState } from "react";
import { Lightbulb, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SubmitState =
  | { status: "idle"; message: string | null }
  | { status: "submitting"; message: string | null }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function BsmIdeaForm() {
  const [state, setState] = useState<SubmitState>({ status: "idle", message: null });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting", message: null });

    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/ops/bsm-progress/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.get("title"),
        description: data.get("description"),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      issueIdentifier?: string;
    };

    if (!response.ok) {
      setState({
        status: "error",
        message: body.error ?? "The idea could not be submitted.",
      });
      return;
    }

    form.reset();
    setState({
      status: "success",
      message: `Idea submitted as ${body.issueIdentifier ?? "a Paperclip task"}.`,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Lightbulb className="size-4 text-ember" aria-hidden="true" />
        <h2 className="font-heading text-base font-semibold">Send a feature idea</h2>
      </div>

      <div className="space-y-2">
        <Label htmlFor="idea-title">Short title</Label>
        <Input
          id="idea-title"
          name="title"
          maxLength={120}
          required
          placeholder="Example: Add a weekly launch-readiness score"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="idea-description">What should improve?</Label>
        <textarea
          id="idea-description"
          name="description"
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="Describe what you want to see, who it helps, and why it matters."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="accent" disabled={state.status === "submitting"}>
          <Send className="size-4" aria-hidden="true" />
          {state.status === "submitting" ? "Submitting" : "Submit idea"}
        </Button>
        {state.message && (
          <p
            className={
              "text-sm " +
              (state.status === "error" ? "text-destructive" : "text-muted-foreground")
            }
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
