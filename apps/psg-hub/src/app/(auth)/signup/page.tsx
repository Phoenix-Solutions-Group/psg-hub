import { Logo } from "@/components/brand/logo";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo variant="primary" className="h-12 w-auto" />
          <p className="mt-6 font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
            Phoenix Solutions Group
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground">
            Create your account
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Join your client hub.
          </p>
        </div>
        <SignupForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="font-medium text-primary hover:text-ember">
            Log in
          </a>
        </p>
      </div>
    </div>
  );
}
