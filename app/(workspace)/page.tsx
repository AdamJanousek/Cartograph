import { Suspense } from "react";
import { AnalysisList } from "@/components/analysis-list";
import { CurrentOrganization } from "@/components/current-organization";

export default function WorkspacePage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b border-border px-3">
        <Suspense>
          <CurrentOrganization />
        </Suspense>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Suspense>
          <AnalysisList />
        </Suspense>
      </div>
    </div>
  );
}
