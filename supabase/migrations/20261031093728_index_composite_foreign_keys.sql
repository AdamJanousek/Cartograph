-- The unique constraints on these tables lead with analysis_id but don't cover
-- the (analysis_id, organization_id) pair the foreign key cascades on.
create index files_analysis_id_idx on public.files (analysis_id, organization_id);
create index routes_analysis_id_idx on public.routes (analysis_id, organization_id);
create index explanations_analysis_id_idx on public.explanations (analysis_id, organization_id);
