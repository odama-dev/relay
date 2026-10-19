import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-body font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 text-title font-medium">Page not found</h1>
        <Link href="/" className="mt-4 inline-block text-body underline underline-offset-4">
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
