import { Suspense } from "react";
import { CurrentOrganization } from "@/components/current-organization";

export default function WorkspacePage() {
  return (
    <div className="flex h-8 items-center border-b border-border px-3">
      <Suspense>
        <CurrentOrganization />
      </Suspense>
    </div>
  );
}
