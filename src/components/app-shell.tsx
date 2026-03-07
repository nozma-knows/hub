"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Overview" },
  { href: "/agents", label: "Agents" },
  { href: "/monitoring", label: "Monitoring" },
  { href: "/access", label: "Access Matrix" },
  { href: "/integrations", label: "Integrations" },
  { href: "/usage", label: "Usage" },
  { href: "/audit", label: "Audit" },
  { href: "/workspace", label: "Workspace" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="rounded-md bg-primary px-2 py-1 text-primary-foreground">Hub</span>
            OpenClaw Control Plane
          </div>
          <nav className="flex items-center gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm transition-colors",
                  pathname === link.href ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <form action="/api/auth/sign-out" method="post">
            <Button size="sm" variant="outline" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
