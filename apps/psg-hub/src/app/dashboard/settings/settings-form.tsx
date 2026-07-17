"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  validateShopSettings,
  type FieldErrors,
  type ShopSettingsField,
} from "@/lib/shop/settings-validation";

/** String-valued form state (radius kept as a string for the input). */
export type SettingsFormValues = {
  name: string;
  telephone: string;
  url: string;
  radius: string;
  address_street: string;
  address_locality: string;
  address_region: string;
  address_postal_code: string;
  hours: string;
};

type Props = {
  initial: SettingsFormValues;
  /** Account email (read-only; from auth, not a shop column). */
  email: string;
  /** Only owner/manager may save; viewers see the form disabled. */
  canEdit: boolean;
};

const inputClass =
  "mt-1 w-full rounded-md border bg-background p-2 text-sm disabled:cursor-not-allowed disabled:opacity-60";

export function SettingsForm({ initial, email, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<SettingsFormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValues(initial);
    setFieldErrors({});
    setFormError(null);
    setSaved(false);
  }, [initial]);

  function set<K extends keyof SettingsFormValues>(
    key: K,
    value: string
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function onCancel() {
    setValues(initial);
    setFieldErrors({});
    setFormError(null);
    setSaved(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaved(false);

    // Client mirror of the server validation, for inline errors before the request.
    const check = validateShopSettings(values);
    if (!check.ok) {
      setFieldErrors(check.fieldErrors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      const res = await fetch("/api/shop/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400 && data.fieldErrors) {
          setFieldErrors(data.fieldErrors as FieldErrors);
          return;
        }
        setFormError(
          typeof data.error === "string"
            ? data.error
            : `Could not save (${res.status}).`
        );
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const err = (f: ShopSettingsField) => fieldErrors[f];

  function field(
    f: ShopSettingsField,
    label: string,
    opts: {
      type?: string;
      placeholder?: string;
      inputMode?: "text" | "numeric" | "tel" | "url";
      maxLength?: number;
    } = {}
  ) {
    const message = err(f);
    const describedBy = message ? `${f}-error` : undefined;
    return (
      <label className="block">
        <span className="text-sm font-medium">{label}</span>
        <input
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          value={values[f as keyof SettingsFormValues]}
          onChange={(e) => set(f as keyof SettingsFormValues, e.target.value)}
          disabled={!canEdit || pending}
          placeholder={opts.placeholder}
          maxLength={opts.maxLength}
          aria-invalid={message ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass}
        />
        {message && (
          <span
            id={`${f}-error`}
            role="alert"
            className="mt-1 block text-sm text-destructive"
          >
            {message}
          </span>
        )}
      </label>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {!canEdit && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          Only owners and managers can edit shop settings. Ask an owner to make
          changes.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field("name", "Shop name", { placeholder: "Shelton Collision" })}
        {field("telephone", "Phone", {
          type: "tel",
          inputMode: "tel",
          placeholder: "(203) 555-0148",
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {field("url", "Website URL", {
          type: "url",
          inputMode: "url",
          placeholder: "https://yourshop.com",
        })}
        {field("radius", "Service radius (miles)", {
          inputMode: "numeric",
          placeholder: "25",
        })}
      </div>

      {field("address_street", "Street address", {
        placeholder: "421 River Rd",
      })}

      <div className="grid gap-4 sm:grid-cols-3">
        {field("address_locality", "City", { placeholder: "Shelton" })}
        {field("address_region", "State", {
          placeholder: "CT",
          maxLength: 2,
        })}
        {field("address_postal_code", "ZIP", {
          inputMode: "numeric",
          placeholder: "06484",
          maxLength: 5,
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {field("hours", "Hours", { placeholder: "Mon–Fri 8–6", maxLength: 200 })}
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            value={email}
            readOnly
            disabled
            aria-describedby="email-note"
            className={inputClass}
          />
          <span
            id="email-note"
            className="mt-1 block text-xs text-muted-foreground"
          >
            This is your account email. Change it from your account settings.
          </span>
        </label>
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      {saved && (
        <div
          role="status"
          className="rounded-md border border-green-700/40 bg-green-100/10 p-3 text-sm text-green-700 dark:text-green-400"
        >
          Settings saved — your shop details are updated.
        </div>
      )}

      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </form>
  );
}
