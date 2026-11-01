import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { Shell } from "@/components/shell";
import { ThemeControl } from "@/components/theme";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    <Shell
      bar={
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
      }
    >
      {children}
    </Shell>
  );
}
