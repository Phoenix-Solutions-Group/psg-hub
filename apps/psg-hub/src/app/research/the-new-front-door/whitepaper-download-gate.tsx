"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Download } from "lucide-react";

const PDF_HREF = "/research/the-new-front-door/psg-aeo-whitepaper.pdf";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function WhitepaperDownloadGate() {
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setMessage("");

    const form = event.currentTarget;
    const body = new FormData(form);
    body.set("referrer", document.referrer || "");

    try {
      const response = await fetch("/api/leads/whitepaper-download", {
        method: "POST",
        body,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not unlock the download.");
      }

      setState("success");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not unlock the download. Please try again."
      );
    }
  }

  return (
    <section className="gate">
      <div className="gate-inner">
        <div>
          <p className="gate-kicker">Download the print-ready PDF</p>
          <h2 className="gate-title">Keep the white paper handy.</h2>
          <p className="gate-copy">
            Enter your email and we will unlock the PDF version for saving, printing, or sharing with your team.
          </p>
        </div>

        {state === "success" ? (
          <div className="gate-success" role="status">
            <p className="gate-success-title">Download unlocked.</p>
            <a className="gate-button" href={PDF_HREF} download>
              <Download aria-hidden="true" size={18} />
              Download PDF
            </a>
          </div>
        ) : (
          <form className="gate-form" onSubmit={onSubmit} noValidate>
            <input
              type="text"
              name="company"
              className="gate-hidden"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />
            <label>
              Email
              <input required type="email" name="email" autoComplete="email" />
            </label>
            <label>
              Name <span>optional</span>
              <input type="text" name="name" autoComplete="name" />
            </label>
            <label>
              Shop name <span>optional</span>
              <input type="text" name="shopName" autoComplete="organization" />
            </label>
            <button className="gate-button" type="submit" disabled={state === "submitting"}>
              <Download aria-hidden="true" size={18} />
              {state === "submitting" ? "Unlocking" : "Unlock PDF"}
            </button>
            {state === "error" ? <p className="gate-error">{message}</p> : null}
          </form>
        )}
      </div>

      <style jsx>{`
        .gate {
          background: #1e3a52;
          color: #fff;
          padding: 34px 24px 42px;
          font-family: "Didact Gothic", "Segoe UI", Helvetica, Arial, sans-serif;
        }
        .gate-inner {
          max-width: 840px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(0, 0.9fr) minmax(280px, 0.7fr);
          gap: 28px;
          align-items: start;
        }
        .gate-kicker {
          margin: 0 0 10px;
          color: #9fc0d8;
          font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace;
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .gate-title {
          margin: 0 0 10px;
          padding: 0;
          border: 0;
          color: #fff;
          font-family: "Montserrat", "Helvetica Neue", Arial, sans-serif;
          font-size: 28px;
          line-height: 1.12;
        }
        .gate-copy {
          margin: 0;
          color: #d7e6f1;
          font-size: 17px;
          line-height: 1.6;
        }
        .gate-form,
        .gate-success {
          display: grid;
          gap: 14px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 10px;
          padding: 18px;
        }
        .gate-form label {
          display: grid;
          gap: 6px;
          color: #d7e6f1;
          font-size: 14px;
        }
        .gate-form label span {
          color: #9fc0d8;
        }
        .gate-form input {
          min-height: 44px;
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 6px;
          background: #fff;
          color: #2b2b2b;
          font: inherit;
          padding: 9px 12px;
        }
        .gate-hidden {
          display: none;
        }
        .gate-button {
          min-height: 46px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          border: 0;
          border-radius: 6px;
          background: #b8483e;
          color: #fff;
          cursor: pointer;
          font-family: "Montserrat", "Helvetica Neue", Arial, sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-decoration: none;
          text-transform: uppercase;
          padding: 12px 16px;
        }
        .gate-button:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }
        .gate-success-title,
        .gate-error {
          margin: 0;
          font-size: 15px;
          line-height: 1.5;
        }
        .gate-success-title {
          color: #d7e6f1;
        }
        .gate-error {
          color: #ffd7d2;
        }
        @media (max-width: 720px) {
          .gate-inner {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
