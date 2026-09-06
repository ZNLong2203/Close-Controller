/**
 * The export control. A plain anchor rather than a fetch + blob: the browser
 * already knows how to save a file the server marked as an attachment, and a
 * link is something a reviewer can copy, bookmark or hand to an auditor.
 */
export function DownloadCsv({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
    >
      <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2v8m0 0L5 7m3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11" strokeLinecap="round" />
      </svg>
      {label}
    </a>
  );
}
