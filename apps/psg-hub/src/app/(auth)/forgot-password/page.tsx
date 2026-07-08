import { Logo } from "@/components/brand/logo";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo variant="primary" className="h-12 w-auto" />
          <p className="mt-6 font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
            Phoenix Solutions Group
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Get reset instructions for your client hub.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remembered your password?{" "}
          <a href="/login" className="font-medium text-primary hover:text-ember">
            Log in
          </a>
        </p>
      </div>
    </div>
  );
}
