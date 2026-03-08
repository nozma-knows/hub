"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <span className="shrink-0 rounded-md bg-primary px-2 py-1 text-primary-foreground">Hub</span>
              <span className="truncate">OpenClaw Control Plane</span>
            </div>

            {/* Desktop nav */}
            <nav className="hidden items-center gap-1 lg:flex">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors",
                    pathname === link.href
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              {/* Mobile menu toggle */}
              <Button
                size="sm"
                variant="outline"
                type="button"
                className="lg:hidden"
                onClick={() => setMobileOpen((v) => !v)}
                aria-expanded={mobileOpen}
                aria-controls="hub-mobile-nav"
              >
                Menu
              </Button>

              <form action="/api/auth/sign-out" method="post">
                <Button size="sm" variant="outline" type="submit">
                  Sign out
                </Button>
              </form>
            </div>
          </div>

          {/* Mobile nav */}
          {mobileOpen ? (
            <nav id="hub-mobile-nav" className="mt-3 grid gap-1 lg:hidden">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors",
                    pathname === link.href
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
