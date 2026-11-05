-- Routes, as the framework adapters read them, and the role names they use.

-- Analyses stored before this carry the old role names and no routes, and
-- pasting a repository's URL never re-runs it. Removing them means pasting
-- the URL again runs a fresh analysis. Projects and organizations stay.
delete from public.analyses;

-- Where in its file a route is declared. Null for a route that comes from the
-- file's path with nothing in the file marking the spot.
alter table public.routes
  add column line integer check (line > 0),
  add constraint routes_method_check
    check (method in ('GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'SEARCH', 'ALL')),
  add constraint routes_pattern_check check (pattern like '/%');

-- Two packages of one repository can both serve GET /, so a route is unique
-- per file, not per analysis.
alter table public.routes drop constraint routes_analysis_id_method_pattern_key;
alter table public.routes add constraint routes_file_id_method_pattern_key unique (file_id, method, pattern);
-- Reads by analysis stay covered by routes_analysis_id_idx, from the
-- composite foreign key migration.

-- A run writes its routes. They go with their files when a store is cleared,
-- through the cascade, so no delete is granted.
grant insert on public.routes to authenticated;

create policy "Members add their organization's routes"
  on public.routes for insert to authenticated
  with check (organization_id = (select private.current_org_id()));
