import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ThemeControl } from "@/components/theme";

// The shell every later phase renders inside. The regions are fixed here:
// the map in the centre, details and chat stacked on the right. Later phases
// fill them in and don't move them.
export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid h-dvh grid-rows-[40px_minmax(0,1fr)]">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-3">
        <span className="font-mono text-[12px] font-semibold tracking-tight">
          cartograph
        </span>
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
        />
        <div className="ml-auto flex items-center gap-3">
          <ThemeControl />
          <UserButton />
        </div>
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px]">
        <main aria-label="Map" className="min-h-0 overflow-hidden">
          {children}
        </main>
        <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] border-l border-border bg-surface">
          <section
            aria-label="Details"
            className="min-h-0 overflow-auto border-b border-border"
          />
          <section aria-label="Chat" className="min-h-0 overflow-auto" />
        </aside>
      </div>
    </div>
  );
}
