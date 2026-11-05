import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnalysisProgress } from "@/components/analysis-progress";
import { CategoryRail } from "@/components/category-rail";
import { DetailPane } from "@/components/detail-pane";
import { InsightsPanel } from "@/components/insights-panel";
import { MapStateProvider } from "@/components/map-state";
import { Shell } from "@/components/shell";
import { WorkspaceViews } from "@/components/workspace-views";
import { WorkspaceBar } from "@/components/workspace-bar";
import { railCategories } from "@/parser/taxonomy";
import { findInsights } from "@/graph/insights";
import { summarize } from "@/graph/summary";
import { isStale } from "@/utils/progress";
import { getAnalysis } from "@/utils/queries/analyses";
import { getAnalysisMap } from "@/utils/queries/analysis-map";

// One address for an analysis: its progress while it runs, its map once it's
// complete. The progress view refreshes when the run ends, which is what
// lands it here on the map.
export default function AnalysisPage({ params }: PageProps<"/analyses/[id]">) {
  return (
    <Suspense fallback={<Shell bar={<WorkspaceBar />} />}>
      <Analysis params={params} />
    </Suspense>
  );
}

async function Analysis({ params }: { params: PageProps<"/analyses/[id]">["params"] }) {
  const { id } = await params;
  const found = await getAnalysis(id);
  if (!found) notFound();
  const { analysis, readAt } = found;

  if (analysis.status !== "complete" || !analysis.project) {
    // Keyed on the row's last change, so a refresh after the run ends starts
    // from the stored state rather than the last live event.
    return (
      <Shell bar={<WorkspaceBar />}>
        <div className="h-full overflow-auto">
          <AnalysisProgress
            key={analysis.updated_at}
            analysis={analysis}
            stale={isStale(analysis.status, analysis.updated_at, readAt)}
          />
        </div>
      </Shell>
    );
  }

  const { owner, name } = analysis.project;
  const result = await getAnalysisMap(analysis.id, {
    owner,
    name,
    frameworks: analysis.frameworks,
    coverage: analysis.coverage,
  });

  return (
    <MapStateProvider files={result.files} edges={result.edges} routes={result.routes}>
      <Shell
        bar={<WorkspaceBar />}
        rail={
          <>
            <CategoryRail categories={railCategories(result.frameworks, result.files.map((file) => file.role))} />
            <InsightsPanel insights={findInsights(result.files, result.edges)} />
          </>
        }
        details={<DetailPane name={`${owner}/${name}`} summary={summarize(result)} />}
      >
        <WorkspaceViews withheld={result.coverage.routes.withheld} />
      </Shell>
    </MapStateProvider>
  );
}
