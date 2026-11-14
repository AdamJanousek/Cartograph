-- Removing a repository from the dashboard, which only an organization admin
-- may do. The project row is what goes: its analysis and everything under that
-- (files, edges, routes, roles, labels, explanations, insights) follow through
-- the cascades, which run as the table owner, so no delete is granted on any
-- of them. Submitting the repository again starts from nothing.

-- The caller's role in the active organization. Clerk's v2 session token puts
-- it under `o.rol` without the `org:` prefix; v1 put it at `org_role` with it.
-- Normalized to the v1 form. Null when no organization is active.
create function private.current_org_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'org_role', 'org:' || (auth.jwt() -> 'o' ->> 'rol'))
$$;

revoke execute on function private.current_org_role() from public;
grant execute on function private.current_org_role() to authenticated;

grant delete on public.projects to authenticated;

create policy "Admins remove their organization's projects"
  on public.projects for delete to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_org_role()) = 'org:admin'
  );
