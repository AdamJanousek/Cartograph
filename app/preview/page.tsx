import { CategoryRail } from "@/components/category-rail";
import { DependencyMap } from "@/components/dependency-map";
import { Shell } from "@/components/shell";
import { ThemeControl } from "@/components/theme";
import { categorize } from "@/graph/categories";
import { previewName, previewResult } from "@/preview/data";

// The real shell over checked-in parser output, reachable without signing in.
export default function PreviewPage() {
  return (
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
      rail={<CategoryRail categories={categorize(previewResult.files)} />}
    >
      <DependencyMap files={previewResult.files} edges={previewResult.edges} />
    </Shell>
  );
}
