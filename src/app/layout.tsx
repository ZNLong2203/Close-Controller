import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Close Controller",
  description: "Autonomous bank reconciliation with human review",
};

const NAV = [
  { href: "/", label: "Run" },
  { href: "/exceptions", label: "Review queue" },
  { href: "/audit", label: "Audit trail" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-border bg-panel">
          <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-[15px] font-semibold tracking-tight">Close Controller</span>
              <span className="text-[11px] uppercase tracking-widest text-muted">Aug 2026</span>
            </Link>
            <nav className="flex gap-5 text-[13px]">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-muted transition-colors hover:text-text">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
