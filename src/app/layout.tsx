import type { Metadata } from "next";

import { TrpcProvider } from "@/components/providers/trpc-provider";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "OpenClaw Hub",
  description: "Manage OpenClaw agents and provider access control"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
