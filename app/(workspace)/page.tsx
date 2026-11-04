import { Suspense } from "react";
import { AnalyseForm } from "@/components/analyse-form";
import { AnalysisList } from "@/components/analysis-list";
import { CurrentOrganization } from "@/components/current-organization";
import { Shell } from "@/components/shell";
import { WorkspaceBar } from "@/components/workspace-bar";

export default function WorkspacePage() {
  return (
    <Shell bar={<WorkspaceBar />}>
      <div className="flex h-full flex-col">
        <div className="flex h-8 shrink-0 items-center border-b border-border px-3">
          <Suspense>
            <CurrentOrganization />
          </Suspense>
        </div>
        <AnalyseForm />
        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense>
            <AnalysisList />
          </Suspense>
        </div>
      </div>
    </Shell>
  );
}
