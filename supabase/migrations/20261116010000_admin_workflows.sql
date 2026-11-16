create table if not exists public.site_content (
    id uuid primary key default gen_random_uuid(),
    page_key text not null check (page_key ~ '^[a-z0-9-]{1,80}$'),
    content_key text not null check (content_key ~ '^[a-z0-9._-]{1,120}$'),
    content_type text not null default 'text' check (content_type in ('text', 'image', 'link')),
    value text not null check (length(value) <= 10000),
    is_published boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (page_key, content_key)
);

create table if not exists public.bookings (
    id uuid primary key default gen_random_uuid(),
    booking_code text not null unique default
        ('BK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
    client_name text not null check (length(trim(client_name)) between 2 and 120),
    email text not null check (length(trim(email)) between 3 and 254),
    phone text not null default '' check (length(phone) <= 40),
    service_type text not null check (length(trim(service_type)) between 2 and 100),
    preferred_date date,
    message text not null default '' check (length(message) <= 5000),
    status text not null default 'new'
        check (status in ('new', 'contacted', 'confirmed', 'completed', 'cancelled')),
    admin_notes text not null default '' check (length(admin_notes) <= 5000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.public_form_attempts (
    id bigint generated always as identity primary key,
    ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now()
);

create table if not exists public.parent_orders (
    id uuid primary key default gen_random_uuid(),
    order_code text not null unique default
        ('MCM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
    learner_id uuid not null references public.learners(id) on delete restrict,
    source text not null default 'admin' check (source in ('parent', 'admin')),
    status text not null default 'submitted'
        check (status in ('submitted', 'confirmed', 'cancelled', 'complete')),
    production_status text not null default 'pending'
        check (production_status in ('pending', 'in_production', 'ready')),
    delivery_status text not null default 'not_started'
        check (delivery_status in ('not_started', 'ready_for_collection', 'dispatched', 'delivered')),
    parent_note text not null default '' check (length(parent_note) <= 2000),
    admin_notes text not null default '' check (length(admin_notes) <= 5000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.parent_order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.parent_orders(id) on delete cascade,
    item_type text not null check (item_type in ('photo', 'package')),
    photo_id uuid references public.school_photos(id) on delete restrict,
    package_id uuid references public.packages(id) on delete restrict,
    title_snapshot text not null check (length(trim(title_snapshot)) between 1 and 160),
    unit_price_cents integer check (unit_price_cents is null or unit_price_cents >= 0),
    created_at timestamptz not null default now(),
    constraint parent_order_items_target_check check (
        (item_type = 'photo' and photo_id is not null and package_id is null)
        or (item_type = 'package' and package_id is not null and photo_id is null)
    )
);

create index if not exists bookings_status_created_idx on public.bookings(status, created_at desc);
create index if not exists public_form_attempts_ip_time_idx on public.public_form_attempts(ip_hash, created_at desc);
create index if not exists parent_orders_learner_created_idx on public.parent_orders(learner_id, created_at desc);
create index if not exists parent_orders_workflow_idx on public.parent_orders(status, production_status, delivery_status);
create index if not exists parent_order_items_order_idx on public.parent_order_items(order_id);
create index if not exists site_content_page_idx on public.site_content(page_key, is_published);

create or replace function public.consume_public_booking_attempt(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    attempt_count integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not authorized';
    end if;
    if p_ip_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid rate-limit key';
    end if;

    perform pg_advisory_xact_lock(hashtext('booking-ip:' || p_ip_hash));
    select count(*) into attempt_count
    from public.public_form_attempts
    where ip_hash = p_ip_hash
      and created_at > now() - interval '15 minutes';

    if attempt_count >= 10 then
        return false;
    end if;

    insert into public.public_form_attempts(ip_hash) values (p_ip_hash);
    return true;
end;
$$;

create or replace function public.submit_parent_order(
    p_learner_id uuid,
    p_photo_ids uuid[],
    p_package_ids uuid[],
    p_parent_note text
)
returns table (id uuid, order_code text, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    new_order_id uuid;
    new_order_code text;
    new_created_at timestamptz;
    photo_count integer;
    package_count integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not authorized';
    end if;
    if p_parent_note is not null and length(p_parent_note) > 2000 then
        raise exception 'parent note is too long';
    end if;
    if coalesce(cardinality(p_photo_ids), 0) > 20
       or coalesce(cardinality(p_package_ids), 0) > 10
       or coalesce(cardinality(p_photo_ids), 0) + coalesce(cardinality(p_package_ids), 0) = 0 then
        raise exception 'invalid order selection';
    end if;

    if not exists (
        select 1
        from public.learners l
        join public.school_classes c on c.id = l.class_id
        join public.school_projects p on p.id = c.project_id
        join public.schools s on s.id = p.school_id
        where l.id = p_learner_id
          and l.is_active
          and l.consent_status = 'approved'
          and p.status = 'active'
          and s.is_active
    ) then
        raise exception 'learner is not eligible to order';
    end if;

    select count(distinct requested.photo_id) into photo_count
    from unnest(coalesce(p_photo_ids, '{}'::uuid[])) as requested(photo_id);
    if photo_count <> coalesce(cardinality(p_photo_ids), 0)
       or exists (
           select 1
           from unnest(coalesce(p_photo_ids, '{}'::uuid[])) as requested(photo_id)
           where not exists (
               select 1 from public.school_photos photo
               where photo.id = requested.photo_id
                 and photo.learner_id = p_learner_id
                 and photo.is_published
           )
       ) then
        raise exception 'invalid photo selection';
    end if;

    select count(distinct requested.package_id) into package_count
    from unnest(coalesce(p_package_ids, '{}'::uuid[])) as requested(package_id);
    if package_count <> coalesce(cardinality(p_package_ids), 0)
       or exists (
           select 1
           from unnest(coalesce(p_package_ids, '{}'::uuid[])) as requested(package_id)
           where not exists (
               select 1 from public.packages package
               where package.id = requested.package_id
                 and package.is_active
           )
       ) then
        raise exception 'invalid package selection';
    end if;

    insert into public.parent_orders(learner_id, source, status, parent_note)
    values (p_learner_id, 'parent', 'submitted', coalesce(p_parent_note, ''))
    returning parent_orders.id, parent_orders.order_code, parent_orders.created_at
    into new_order_id, new_order_code, new_created_at;

    insert into public.parent_order_items(order_id, item_type, photo_id, title_snapshot)
    select new_order_id, 'photo', photo.id, photo.title
    from public.school_photos photo
    where photo.id = any(coalesce(p_photo_ids, '{}'::uuid[]));

    insert into public.parent_order_items(
        order_id, item_type, package_id, title_snapshot, unit_price_cents
    )
    select new_order_id, 'package', package.id, package.name, package.price_cents
    from public.packages package
    where package.id = any(coalesce(p_package_ids, '{}'::uuid[]));

    return query select new_order_id, new_order_code, 'submitted'::text, new_created_at;
end;
$$;

create or replace function public.create_admin_order(
    p_learner_id uuid,
    p_photo_ids uuid[],
    p_package_ids uuid[],
    p_admin_notes text
)
returns table (id uuid, order_code text, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    new_order_id uuid;
    new_order_code text;
    new_created_at timestamptz;
    photo_count integer;
    package_count integer;
begin
    if auth.role() is distinct from 'authenticated' or not public.current_user_is_admin() then
        raise exception 'not authorized';
    end if;
    if p_admin_notes is not null and length(p_admin_notes) > 5000 then
        raise exception 'admin notes are too long';
    end if;
    if coalesce(cardinality(p_photo_ids), 0) > 20
       or coalesce(cardinality(p_package_ids), 0) > 10 then
        raise exception 'invalid order selection';
    end if;
    if not exists (select 1 from public.learners where learners.id = p_learner_id) then
        raise exception 'learner not found';
    end if;

    select count(distinct requested.photo_id) into photo_count
    from unnest(coalesce(p_photo_ids, '{}'::uuid[])) as requested(photo_id);
    if photo_count <> coalesce(cardinality(p_photo_ids), 0)
       or exists (
           select 1
           from unnest(coalesce(p_photo_ids, '{}'::uuid[])) as requested(photo_id)
           where not exists (
               select 1 from public.school_photos photo
               where photo.id = requested.photo_id
                 and photo.learner_id = p_learner_id
           )
       ) then
        raise exception 'invalid photo selection';
    end if;

    select count(distinct requested.package_id) into package_count
    from unnest(coalesce(p_package_ids, '{}'::uuid[])) as requested(package_id);
    if package_count <> coalesce(cardinality(p_package_ids), 0)
       or exists (
           select 1
           from unnest(coalesce(p_package_ids, '{}'::uuid[])) as requested(package_id)
           where not exists (
               select 1 from public.packages package
               where package.id = requested.package_id
                 and package.is_active
           )
       ) then
        raise exception 'invalid package selection';
    end if;

    insert into public.parent_orders(
        learner_id, source, status, parent_note, admin_notes
    )
    values (
        p_learner_id, 'admin', 'confirmed', '',
        coalesce(p_admin_notes, '')
    )
    returning parent_orders.id, parent_orders.order_code, parent_orders.created_at
    into new_order_id, new_order_code, new_created_at;

    insert into public.parent_order_items(order_id, item_type, photo_id, title_snapshot)
    select new_order_id, 'photo', photo.id, photo.title
    from public.school_photos photo
    where photo.id = any(coalesce(p_photo_ids, '{}'::uuid[]));

    insert into public.parent_order_items(
        order_id, item_type, package_id, title_snapshot, unit_price_cents
    )
    select new_order_id, 'package', package.id, package.name, package.price_cents
    from public.packages package
    where package.id = any(coalesce(p_package_ids, '{}'::uuid[]));

    return query select new_order_id, new_order_code, 'confirmed'::text, new_created_at;
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

    delete from public.public_form_attempts
    where created_at < now() - interval '24 hours';

    delete from public.parent_sessions
    where expires_at < now() - interval '7 days'
       or revoked_at < now() - interval '7 days';
end;
$$;

revoke all on function public.consume_public_booking_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_public_booking_attempt(text) to service_role;
revoke all on function public.submit_parent_order(uuid, uuid[], uuid[], text) from public, anon, authenticated;
grant execute on function public.submit_parent_order(uuid, uuid[], uuid[], text) to service_role;
revoke all on function public.create_admin_order(uuid, uuid[], uuid[], text) from public, anon;
grant execute on function public.create_admin_order(uuid, uuid[], uuid[], text) to authenticated;
revoke all on function public.prune_parent_security_records() from public, anon, authenticated, service_role;

drop trigger if exists site_content_set_updated_at on public.site_content;
create trigger site_content_set_updated_at before update on public.site_content
    for each row execute function public.set_updated_at();
drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at before update on public.bookings
    for each row execute function public.set_updated_at();
drop trigger if exists parent_orders_set_updated_at on public.parent_orders;
create trigger parent_orders_set_updated_at before update on public.parent_orders
    for each row execute function public.set_updated_at();

drop trigger if exists site_content_audit on public.site_content;
create trigger site_content_audit after insert or update or delete on public.site_content
    for each row execute function public.write_admin_audit_log();
drop trigger if exists bookings_audit on public.bookings;
create trigger bookings_audit after insert or update or delete on public.bookings
    for each row execute function public.write_admin_audit_log();
drop trigger if exists parent_orders_audit on public.parent_orders;
create trigger parent_orders_audit after insert or update or delete on public.parent_orders
    for each row execute function public.write_admin_audit_log();
drop trigger if exists parent_order_items_audit on public.parent_order_items;
create trigger parent_order_items_audit after insert or update or delete on public.parent_order_items
    for each row execute function public.write_admin_audit_log();

alter table public.site_content enable row level security;
alter table public.bookings enable row level security;
alter table public.public_form_attempts enable row level security;
alter table public.parent_orders enable row level security;
alter table public.parent_order_items enable row level security;

grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;
grant select on public.packages to anon;
grant select, insert, update, delete on public.bookings to authenticated;
grant all on public.bookings, public.public_form_attempts, public.parent_orders, public.parent_order_items to service_role;
grant select, insert, update, delete on public.parent_orders, public.parent_order_items to authenticated;
grant usage, select on sequence public.public_form_attempts_id_seq to service_role;

drop policy if exists public_read_published_site_content on public.site_content;
create policy public_read_published_site_content on public.site_content
    for select to anon, authenticated
    using (is_published);
drop policy if exists admins_manage_site_content on public.site_content;
create policy admins_manage_site_content on public.site_content
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
drop policy if exists admins_manage_bookings on public.bookings;
create policy admins_manage_bookings on public.bookings
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
drop policy if exists admins_manage_parent_orders on public.parent_orders;
create policy admins_manage_parent_orders on public.parent_orders
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
drop policy if exists admins_manage_parent_order_items on public.parent_order_items;
create policy admins_manage_parent_order_items on public.parent_order_items
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());

drop policy if exists public_read_active_packages on public.packages;
create policy public_read_active_packages on public.packages
    for select to anon, authenticated
    using (is_active);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'site-media',
    'site-media',
    true,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists public_read_site_media on storage.objects;
create policy public_read_site_media on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'site-media');
drop policy if exists admins_manage_site_media on storage.objects;
create policy admins_manage_site_media on storage.objects
    for all to authenticated
    using (bucket_id = 'site-media' and public.current_user_is_admin())
    with check (bucket_id = 'site-media' and public.current_user_is_admin());
