import { Logo } from "@/components/brand/logo";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo variant="primary" className="h-12 w-auto" />
          <p className="mt-6 font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
            Phoenix Solutions Group
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your client hub.
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No account?{" "}
          <a href="/signup" className="font-medium text-primary hover:text-ember">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
