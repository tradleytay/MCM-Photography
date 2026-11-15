create table public.schools (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) between 2 and 160),
    slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.school_projects (
    id uuid primary key default gen_random_uuid(),
    school_id uuid not null references public.schools(id) on delete restrict,
    name text not null check (length(trim(name)) between 2 and 160),
    school_year integer not null check (school_year between 2000 and 2200),
    status text not null default 'draft' check (status in ('draft', 'active', 'complete', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (school_id, name, school_year)
);

create table public.school_classes (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.school_projects(id) on delete restrict,
    name text not null check (length(trim(name)) between 1 and 100),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, name)
);

create table public.learners (
    id uuid primary key default gen_random_uuid(),
    class_id uuid not null references public.school_classes(id) on delete restrict,
    reference_code text not null unique check (reference_code ~ '^[A-Z0-9-]{4,40}$'),
    display_name text not null check (length(trim(display_name)) between 1 and 160),
    is_active boolean not null default true,
    consent_status text not null default 'pending'
        check (consent_status in ('pending', 'approved', 'denied', 'withdrawn')),
    consent_recorded_at timestamptz,
    consent_source text,
    constraint learners_consent_evidence_check check (
        (consent_status = 'pending' and consent_recorded_at is null)
        or (
            consent_status <> 'pending'
            and consent_recorded_at is not null
            and consent_source is not null
            and length(trim(consent_source)) between 3 and 500
        )
    ),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.learner_access_credentials (
    learner_id uuid primary key references public.learners(id) on delete cascade,
    pin_hash text not null check (length(pin_hash) <= 256),
    updated_at timestamptz not null default now()
);

create table public.school_photos (
    id uuid primary key default gen_random_uuid(),
    learner_id uuid not null references public.learners(id) on delete cascade,
    storage_path text not null unique,
    title text not null default 'School portrait' check (length(trim(title)) between 1 and 160),
    display_order integer not null default 0,
    is_published boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.packages (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) between 2 and 120),
    description text not null default '',
    price_cents integer not null check (price_cents >= 0),
    is_active boolean not null default true,
    display_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.parent_access_attempts (
    id bigint generated always as identity primary key,
    reference_hash text not null check (reference_hash ~ '^[0-9a-f]{64}$'),
    ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now()
);

create table public.parent_sessions (
    token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
    learner_id uuid not null references public.learners(id) on delete cascade,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    last_used_at timestamptz not null default now()
);

create table public.admin_audit_log (
    id bigint generated always as identity primary key,
    actor_id uuid references auth.users(id) on delete set null,
    action text not null,
    resource_table text not null,
    resource_id uuid,
    created_at timestamptz not null default now()
);

create index school_projects_school_year_idx on public.school_projects(school_id, school_year);
create index school_classes_project_idx on public.school_classes(project_id);
create index learners_class_idx on public.learners(class_id);
create index school_photos_learner_published_order_idx
    on public.school_photos(learner_id, is_published, display_order);
create index parent_access_attempts_reference_time_idx
    on public.parent_access_attempts(reference_hash, created_at desc);
create index parent_access_attempts_created_idx on public.parent_access_attempts(created_at);
create index parent_access_attempts_ip_time_idx
    on public.parent_access_attempts(ip_hash, created_at desc)
    where ip_hash is not null;
create index parent_sessions_learner_expiry_idx
    on public.parent_sessions(learner_id, expires_at);
create index admin_audit_log_created_idx on public.admin_audit_log(created_at desc);

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
set search_path = pg_catalog, auth
as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false)
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create or replace function public.write_admin_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
    if tg_op = 'DELETE' then
        insert into public.admin_audit_log(actor_id, action, resource_table, resource_id)
        values (auth.uid(), tg_op, tg_table_name, old.id);
        return old;
    end if;

    insert into public.admin_audit_log(actor_id, action, resource_table, resource_id)
    values (auth.uid(), tg_op, tg_table_name, new.id);
    return new;
end;
$$;

create or replace function public.consume_parent_access_attempt(
    p_reference_hash text,
    p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    reference_attempts integer;
    ip_attempts integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not authorized';
    end if;
    if p_reference_hash !~ '^[0-9a-f]{64}$'
       or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$') then
        raise exception 'invalid rate-limit key';
    end if;

    perform pg_advisory_xact_lock(hashtext('reference:' || p_reference_hash));
    if p_ip_hash is not null then
        perform pg_advisory_xact_lock(hashtext('ip:' || p_ip_hash));
    end if;

    select count(*) into reference_attempts
    from public.parent_access_attempts
    where reference_hash = p_reference_hash
      and created_at > now() - interval '15 minutes';

    if p_ip_hash is not null then
        select count(*) into ip_attempts
        from public.parent_access_attempts
        where ip_hash = p_ip_hash
          and created_at > now() - interval '15 minutes';
    else
        ip_attempts := 0;
    end if;

    if reference_attempts >= 5 or ip_attempts >= 30 then
        return false;
    end if;

    insert into public.parent_access_attempts(reference_hash, ip_hash)
    values (p_reference_hash, p_ip_hash);
    return true;
end;
$$;

create or replace function public.admin_update_learner_pin(
    p_learner_id uuid,
    p_pin_hash text,
    p_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not authorized';
    end if;
    if p_pin_hash !~ '^pbkdf2_sha256\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$' then
        raise exception 'invalid pin hash';
    end if;
    if not exists (select 1 from public.learners where id = p_learner_id) then
        raise exception 'learner not found';
    end if;

    insert into public.learner_access_credentials(learner_id, pin_hash)
    values (p_learner_id, p_pin_hash)
    on conflict (learner_id) do update
    set pin_hash = excluded.pin_hash,
        updated_at = now();

    update public.parent_sessions
    set revoked_at = now()
    where learner_id = p_learner_id
      and revoked_at is null;

    insert into public.admin_audit_log(actor_id, action, resource_table, resource_id)
    values (p_admin_id, 'SET_LEARNER_PIN', 'learner_access_credentials', p_learner_id);
end;
$$;

create or replace function public.prune_parent_security_records()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    delete from public.parent_access_attempts
    where created_at < now() - interval '24 hours';

    delete from public.parent_sessions
    where expires_at < now() - interval '7 days'
       or revoked_at < now() - interval '7 days';
end;
$$;

revoke all on function public.current_user_is_admin() from public, anon;
grant execute on function public.current_user_is_admin() to authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.write_admin_audit_log() from public, anon, authenticated;
revoke all on function public.consume_parent_access_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_parent_access_attempt(text, text) to service_role;
revoke all on function public.admin_update_learner_pin(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_update_learner_pin(uuid, text, uuid) to service_role;
revoke all on function public.prune_parent_security_records() from public, anon, authenticated, service_role;

create trigger schools_set_updated_at before update on public.schools
    for each row execute function public.set_updated_at();
create trigger school_projects_set_updated_at before update on public.school_projects
    for each row execute function public.set_updated_at();
create trigger school_classes_set_updated_at before update on public.school_classes
    for each row execute function public.set_updated_at();
create trigger learners_set_updated_at before update on public.learners
    for each row execute function public.set_updated_at();
create trigger learner_access_credentials_set_updated_at before update on public.learner_access_credentials
    for each row execute function public.set_updated_at();
create trigger school_photos_set_updated_at before update on public.school_photos
    for each row execute function public.set_updated_at();
create trigger packages_set_updated_at before update on public.packages
    for each row execute function public.set_updated_at();

create trigger schools_audit after insert or update or delete on public.schools
    for each row execute function public.write_admin_audit_log();
create trigger school_projects_audit after insert or update or delete on public.school_projects
    for each row execute function public.write_admin_audit_log();
create trigger school_classes_audit after insert or update or delete on public.school_classes
    for each row execute function public.write_admin_audit_log();
create trigger learners_audit after insert or update or delete on public.learners
    for each row execute function public.write_admin_audit_log();
create trigger school_photos_audit after insert or update or delete on public.school_photos
    for each row execute function public.write_admin_audit_log();
create trigger packages_audit after insert or update or delete on public.packages
    for each row execute function public.write_admin_audit_log();

alter table public.schools enable row level security;
alter table public.school_projects enable row level security;
alter table public.school_classes enable row level security;
alter table public.learners enable row level security;
alter table public.learner_access_credentials enable row level security;
alter table public.school_photos enable row level security;
alter table public.packages enable row level security;
alter table public.parent_access_attempts enable row level security;
alter table public.parent_sessions enable row level security;
alter table public.admin_audit_log enable row level security;

grant select, insert, update, delete on
    public.schools,
    public.school_projects,
    public.school_classes,
    public.learners,
    public.school_photos,
    public.packages
to authenticated;
grant select on public.admin_audit_log to authenticated;
grant all on
    public.schools,
    public.school_projects,
    public.school_classes,
    public.learners,
    public.learner_access_credentials,
    public.school_photos,
    public.packages,
    public.parent_access_attempts,
    public.parent_sessions
to service_role;
grant select, insert on public.admin_audit_log to service_role;
revoke all on
    public.learner_access_credentials,
    public.parent_access_attempts,
    public.parent_sessions
from anon, authenticated;
grant usage, select on sequence public.parent_access_attempts_id_seq to service_role;
grant usage, select on sequence public.admin_audit_log_id_seq to service_role;

create policy admins_manage_schools on public.schools
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_projects on public.school_projects
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_classes on public.school_classes
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_learners on public.learners
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_photos on public.school_photos
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_packages on public.packages
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_read_audit_log on public.admin_audit_log
    for select to authenticated
    using (public.current_user_is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'learner-photos',
    'learner-photos',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy admins_manage_learner_photo_objects on storage.objects
    for all to authenticated
    using (bucket_id = 'learner-photos' and public.current_user_is_admin())
    with check (bucket_id = 'learner-photos' and public.current_user_is_admin());
