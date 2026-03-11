"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc-client";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Overview" },
  { href: "/messages", label: "Messages" },
  { href: "/tickets", label: "Tickets" },
  { href: "/agents", label: "Agents" },
  { href: "/monitoring", label: "Monitoring" },
  { href: "/schedules", label: "Schedules" },
  { href: "/integrations", label: "Integrations" },
  { href: "/usage", label: "Usage" },
  { href: "/audit", label: "Audit" },
  { href: "/workspace", label: "Workspace" }
];

export function AppShell({
  children,
  mainClassName
}: {
  children: React.ReactNode;
  mainClassName?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const utils = trpc.useUtils();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur h-14 relative">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <span className="shrink-0 rounded-md bg-primary px-2 py-1 text-primary-foreground">Hub</span>
            </div>

            {/* Desktop nav */}
            <nav className="hidden items-center gap-1 lg:flex">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onMouseEnter={() => {
                    if (link.href === "/messages") {
                      void utils.messages.channelsList.prefetch();
                    }
                  }}
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
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Mobile menu toggle */}
            <Button
              size="sm"
              variant="outline"
              type="button"
              className="lg:hidden px-2"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="hub-mobile-nav"
            >
              Menu
            </Button>

            <form
              action="/api/auth/sign-out"
              method="post"
              onSubmit={(e) => {
                // better-auth requires Content-Type application/json for POST sign-out.
                e.preventDefault();
                fetch("/api/auth/sign-out", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}"
                })
                  .catch(() => {
                    // ignore
                  })
                  .finally(() => {
                    window.location.href = "/sign-in";
                  });
              }}
            >
              <Button
                size="sm"
                variant="outline"
                type="submit"
                className="h-9 w-9 rounded-md p-0"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>

        </div>

        {/* Mobile nav (rendered outside the header flex row so it doesn't shift the right-side buttons) */}
        {mobileOpen ? (
          <div className="lg:hidden">
            <div
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <nav
              id="hub-mobile-nav"
              className="absolute left-4 right-4 top-full z-50 mt-3 grid gap-1 rounded-md border bg-background p-2 shadow-lg"
            >
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
          </div>
        ) : null}
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8",
          mainClassName
        )}
      >
        {children}
      </main>
    </div>
  );
}
