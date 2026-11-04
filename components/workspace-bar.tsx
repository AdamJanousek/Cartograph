import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ThemeControl } from "@/components/theme";

// The signed-in top bar. Each workspace page renders the shell itself, because
// the map page fills the rail and details and wraps all of it in shared state.
export function WorkspaceBar() {
  return (
    <>
      <OrganizationSwitcher
        hidePersonal
        afterSelectOrganizationUrl="/"
        afterCreateOrganizationUrl="/"
      />
      <div className="ml-auto flex items-center gap-3">
        <ThemeControl />
        <UserButton />
      </div>
    </>
  );
}
