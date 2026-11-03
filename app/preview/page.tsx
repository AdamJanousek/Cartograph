import { CategoryRail } from "@/components/category-rail";
import { DependencyMap } from "@/components/dependency-map";
import { DetailPane } from "@/components/detail-pane";
import { InsightsPanel } from "@/components/insights-panel";
import { MapStateProvider } from "@/components/map-state";
import { Shell } from "@/components/shell";
import { ThemeControl } from "@/components/theme";
import { categorize } from "@/graph/categories";
import { findInsights } from "@/graph/insights";
import { summarize } from "@/graph/summary";
import { previewName, previewResult } from "@/preview/data";

// The real shell over checked-in parser output, reachable without signing in.
export default function PreviewPage() {
  return (
    <MapStateProvider files={previewResult.files} edges={previewResult.edges}>
      <Shell
        bar={
          <>
            <span className="font-mono text-[12px] text-text-muted">
              preview · {previewName} · {previewResult.files.length} files
            </span>
            <div className="ml-auto flex items-center gap-3">
              <ThemeControl />
            </div>
          </>
        }
        rail={
          <>
            <CategoryRail categories={categorize(previewResult.files)} />
            <InsightsPanel insights={findInsights(previewResult.files, previewResult.edges)} />
          </>
        }
        details={<DetailPane name={previewName} summary={summarize(previewResult)} />}
      >
        <DependencyMap />
      </Shell>
    </MapStateProvider>
  );
}
