alter table public.schools
    add column if not exists contact_email text not null default '',
    add column if not exists phone text not null default '',
    add column if not exists address text not null default '';

alter table public.school_projects
    add column if not exists photography_start_date date,
    add column if not exists photography_end_date date,
    add column if not exists notes text not null default '';

alter table public.school_projects
    drop constraint if exists school_projects_photo_dates_check;
alter table public.school_projects
    add constraint school_projects_photo_dates_check
        check (
            photography_start_date is null
            or photography_end_date is null
            or photography_end_date >= photography_start_date
        );

alter table public.bookings
    add column if not exists preferred_time time,
    add column if not exists location text not null default '',
    add column if not exists scheduled_date date,
    add column if not exists scheduled_time time,
    add column if not exists deposit_amount_cents integer not null default 0,
    add column if not exists deposit_paid_at timestamptz,
    add column if not exists deposit_reference text not null default '';

alter table public.bookings
    drop constraint if exists bookings_status_check;
alter table public.bookings
    add constraint bookings_status_check
        check (status in ('new', 'contacted', 'confirmed', 'completed', 'cancelled', 'declined'));
alter table public.bookings
    drop constraint if exists bookings_contact_details_check;
alter table public.bookings
    add constraint bookings_contact_details_check
        check (
            length(location) <= 500
            and length(deposit_reference) <= 200
            and deposit_amount_cents >= 0
        );

create unique index if not exists bookings_confirmed_schedule_unique_idx
    on public.bookings(scheduled_date, scheduled_time)
    where status = 'confirmed'
      and scheduled_date is not null
      and scheduled_time is not null;

create or replace function public.enforce_booking_schedule()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
    duration integer;
    working_days smallint[];
    workday_start time;
    workday_end time;
    lead_days integer;
    slot_start timestamp;
    slot_end timestamp;
begin
    if new.status <> 'confirmed' then
        return new;
    end if;
    if new.scheduled_date is null or new.scheduled_time is null then
        raise exception 'confirmed bookings require a scheduled date and time';
    end if;

    select coalesce(service.duration_minutes, 60)
    into duration
    from public.booking_services service
    where service.name = new.service_type;
    duration := coalesce(duration, 60);
    slot_start := new.scheduled_date + new.scheduled_time;
    slot_end := slot_start + make_interval(mins => duration);

    perform pg_advisory_xact_lock(hashtext('booking-day:' || new.scheduled_date::text));
    if exists (
        select 1
        from public.bookings booking
        left join public.booking_services service on service.name = booking.service_type
        where booking.id <> new.id
          and booking.status = 'confirmed'
          and booking.scheduled_date = new.scheduled_date
          and tsrange(
                booking.scheduled_date + booking.scheduled_time,
                booking.scheduled_date + booking.scheduled_time +
                    make_interval(mins => coalesce(service.duration_minutes, 60)),
                '[)'
              ) && tsrange(slot_start, slot_end, '[)')
    ) then
        raise exception 'booking schedule conflicts with another confirmed session';
    end if;

    select settings.working_days, settings.working_day_start,
           settings.working_day_end, settings.booking_lead_days
    into working_days, workday_start, workday_end, lead_days
    from public.studio_settings settings
    where settings.singleton
    limit 1;
    if found then
        if extract(dow from new.scheduled_date)::smallint <> all(working_days) then
            raise exception 'the selected date is not a configured working day';
        end if;
        if new.scheduled_time < workday_start or new.scheduled_time >= workday_end then
            raise exception 'the selected time is outside configured working hours';
        end if;
        if new.scheduled_date < current_date + lead_days then
            raise exception 'the selected date is before the configured booking lead time';
        end if;
    end if;
    return new;
end;
$$;

create table if not exists public.booking_services (
    id uuid primary key default gen_random_uuid(),
    name text not null unique check (length(trim(name)) between 2 and 100),
    duration_minutes integer not null default 60 check (duration_minutes between 15 and 1440),
    display_order integer not null default 0 check (display_order >= 0),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.booking_services(name, display_order)
values
    ('Wedding photography', 1),
    ('Portrait photography', 2),
    ('Event photography', 3),
    ('Fashion photography', 4),
    ('School photography', 5),
    ('Other enquiry', 6)
on conflict (name) do nothing;

create table if not exists public.studio_settings (
    id uuid primary key default gen_random_uuid(),
    singleton boolean not null default true unique check (singleton),
    business_name text not null default 'MCM Photography',
    business_email text not null default '',
    contact_phone text not null default '',
    business_address text not null default '',
    working_days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
    working_day_start time not null default '09:00',
    working_day_end time not null default '17:00',
    booking_lead_days integer not null default 1 check (booking_lead_days between 0 and 365),
    watermark_text text not null default 'MCM PHOTOGRAPHY' check (length(watermark_text) between 1 and 80),
    watermark_opacity numeric(3, 2) not null default 0.35 check (watermark_opacity between 0.10 and 1.00),
    watermark_position text not null default 'bottom-right'
        check (watermark_position in ('center', 'bottom-left', 'bottom-right')),
    preview_quality smallint not null default 72 check (preview_quality between 40 and 90),
    preview_max_width smallint not null default 1600 check (preview_max_width between 640 and 2400),
    download_policy text not null default 'paid'
        check (download_policy in ('manual', 'paid', 'disabled')),
    constraint studio_settings_working_hours_check check (working_day_start < working_day_end),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.studio_settings(singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, auth
as $$
    select exists (
        select 1
        from auth.users user_record
        where user_record.id = auth.uid()
          and coalesce(user_record.raw_app_meta_data ->> 'role', '') = 'admin'
          and coalesce(user_record.raw_app_meta_data ->> 'admin_suspended', 'false') <> 'true'
    )
$$;

revoke all on function public.current_user_is_admin() from public, anon;
grant execute on function public.current_user_is_admin() to anon;
grant execute on function public.current_user_is_admin() to authenticated;

create table if not exists public.guardians (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (length(trim(full_name)) between 2 and 160),
    email text not null default '' check (length(email) <= 254),
    phone text not null default '' check (length(phone) <= 40),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.learner_guardians (
    id uuid primary key default gen_random_uuid(),
    learner_id uuid not null references public.learners(id) on delete cascade,
    guardian_id uuid not null references public.guardians(id) on delete cascade,
    relationship text not null default '' check (length(relationship) <= 80),
    is_primary boolean not null default false,
    created_at timestamptz not null default now(),
    unique (learner_id, guardian_id)
);

create unique index if not exists learner_guardians_one_primary_idx
    on public.learner_guardians(learner_id)
    where is_primary;

create table if not exists public.photo_batches (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.school_projects(id) on delete restrict,
    label text not null check (length(trim(label)) between 2 and 160),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

alter table public.school_photos
    alter column learner_id drop not null,
    add column if not exists project_id uuid references public.school_projects(id) on delete restrict,
    add column if not exists batch_id uuid references public.photo_batches(id) on delete set null,
    add column if not exists preview_storage_path text,
    add column if not exists sha256 text,
    add column if not exists price_cents integer not null default 0,
    add column if not exists is_archived boolean not null default false,
    add column if not exists assignment_status text not null default 'assigned';

update public.school_photos photo
set project_id = school_class.project_id
from public.learners learner
join public.school_classes school_class on school_class.id = learner.class_id
where photo.learner_id = learner.id
  and photo.project_id is null;

alter table public.school_photos
    drop constraint if exists school_photos_assignment_status_check,
    drop constraint if exists school_photos_sha256_check,
    drop constraint if exists school_photos_price_cents_check,
    drop constraint if exists school_photos_assignment_state_check;
alter table public.school_photos
    add constraint school_photos_assignment_status_check
        check (assignment_status in ('unassigned', 'assigned')),
    add constraint school_photos_sha256_check
        check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
    add constraint school_photos_price_cents_check
        check (price_cents >= 0),
    add constraint school_photos_assignment_state_check
        check (
            (assignment_status = 'unassigned' and learner_id is null and is_published = false)
            or (assignment_status = 'assigned' and learner_id is not null)
        );

update public.school_photos
set assignment_status = case when learner_id is null then 'unassigned' else 'assigned' end;

create index if not exists school_photos_project_status_idx
    on public.school_photos(project_id, assignment_status, is_published, is_archived);
create index if not exists school_photos_sha256_idx
    on public.school_photos(sha256)
    where sha256 is not null;
create index if not exists photo_batches_project_created_idx
    on public.photo_batches(project_id, created_at desc);
create index if not exists learner_guardians_guardian_idx
    on public.learner_guardians(guardian_id);

alter table public.parent_orders
    add column if not exists cancellation_reason text not null default '',
    add column if not exists production_instructions text not null default '',
    add column if not exists production_updated_at timestamptz,
    add column if not exists delivery_date date,
    add column if not exists delivery_notes text not null default '';

alter table public.parent_orders
    drop constraint if exists parent_orders_fulfilment_notes_check;
alter table public.parent_orders
    add constraint parent_orders_fulfilment_notes_check
        check (
            length(cancellation_reason) <= 1000
            and length(production_instructions) <= 2000
            and length(delivery_notes) <= 2000
        );

alter table public.parent_orders
    drop constraint if exists parent_orders_production_status_check;
alter table public.parent_orders
    add constraint parent_orders_production_status_check
        check (production_status in (
            'pending',
            'in_production',
            'awaiting_outsourced_product',
            'quality_check',
            'ready'
        ));

alter table public.parent_orders
    drop constraint if exists parent_orders_delivery_status_check;
alter table public.parent_orders
    add constraint parent_orders_delivery_status_check
        check (delivery_status in (
            'not_started',
            'awaiting_dispatch',
            'ready_for_collection',
            'dispatched',
            'collected',
            'delivered'
        ));

update public.parent_order_items item
set unit_price_cents = coalesce(
    case
        when item.item_type = 'package' then (
            select package.price_cents
            from public.packages package
            where package.id = item.package_id
        )
        when item.item_type = 'photo' then (
            select photo.price_cents
            from public.school_photos photo
            where photo.id = item.photo_id
        )
    end,
    0
)
where item.unit_price_cents is null;

alter table public.parent_order_items
    alter column unit_price_cents set default 0;
update public.parent_order_items
set unit_price_cents = 0
where unit_price_cents is null;

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
        from public.learners learner
        join public.school_classes school_class on school_class.id = learner.class_id
        join public.school_projects project on project.id = school_class.project_id
        join public.schools school on school.id = project.school_id
        where learner.id = p_learner_id
          and learner.is_active
          and learner.consent_status = 'approved'
          and project.status = 'active'
          and school.is_active
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
                 and not photo.is_archived
                 and photo.preview_storage_path is not null
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

    insert into public.parent_order_items(
        order_id, item_type, photo_id, title_snapshot, unit_price_cents
    )
    select new_order_id, 'photo', photo.id, photo.title, photo.price_cents
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
       or coalesce(cardinality(p_package_ids), 0) > 10
       or coalesce(cardinality(p_photo_ids), 0) + coalesce(cardinality(p_package_ids), 0) = 0 then
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
                 and not photo.is_archived
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

    insert into public.parent_order_items(
        order_id, item_type, photo_id, title_snapshot, unit_price_cents
    )
    select new_order_id, 'photo', photo.id, photo.title, photo.price_cents
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

revoke all on function public.submit_parent_order(uuid, uuid[], uuid[], text) from public, anon, authenticated;
grant execute on function public.submit_parent_order(uuid, uuid[], uuid[], text) to service_role;
revoke all on function public.create_admin_order(uuid, uuid[], uuid[], text) from public, anon;
grant execute on function public.create_admin_order(uuid, uuid[], uuid[], text) to authenticated;

create table if not exists public.order_payments (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null unique references public.parent_orders(id) on delete restrict,
    status text not null default 'awaiting_payment'
        check (status in (
            'awaiting_payment',
            'proof_reported',
            'under_verification',
            'verified',
            'rejected',
            'refunded'
        )),
    expected_amount_cents integer not null check (expected_amount_cents >= 0),
    amount_received_cents integer not null default 0 check (amount_received_cents >= 0),
    payment_reference text not null default '' check (length(payment_reference) <= 200),
    payment_channel text not null default 'bank_transfer'
        check (payment_channel in ('bank_transfer', 'cash', 'other')),
    proof_reported_at timestamptz,
    verified_at timestamptz,
    verified_by uuid references auth.users(id) on delete set null,
    verified_by_email text not null default '',
    admin_notes text not null default '' check (length(admin_notes) <= 5000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint order_payments_verified_evidence_check
        check (status <> 'verified' or (
            verified_at is not null
            and verified_by is not null
            and length(trim(payment_reference)) >= 3
            and amount_received_cents >= expected_amount_cents
        ))
);

create table if not exists public.booking_status_history (
    id bigint generated always as identity primary key,
    booking_id uuid not null references public.bookings(id) on delete cascade,
    actor_id uuid references auth.users(id) on delete set null,
    old_status text,
    new_status text not null,
    scheduled_date date,
    scheduled_time time,
    notes text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.order_status_history (
    id bigint generated always as identity primary key,
    order_id uuid not null references public.parent_orders(id) on delete cascade,
    actor_id uuid references auth.users(id) on delete set null,
    old_status text,
    new_status text not null,
    old_production_status text,
    new_production_status text not null,
    old_delivery_status text,
    new_delivery_status text not null,
    notes text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.order_payment_history (
    id bigint generated always as identity primary key,
    payment_id uuid not null references public.order_payments(id) on delete cascade,
    actor_id uuid references auth.users(id) on delete set null,
    old_status text,
    new_status text not null,
    payment_reference text not null default '',
    amount_received_cents integer not null,
    notes text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.photo_download_requests (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.parent_orders(id) on delete restrict,
    learner_id uuid not null references public.learners(id) on delete restrict,
    photo_id uuid not null references public.school_photos(id) on delete restrict,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    approved_by uuid references auth.users(id) on delete set null,
    approved_at timestamptz,
    download_count smallint not null default 0 check (download_count between 0 and 5),
    last_downloaded_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (order_id, photo_id),
    constraint photo_download_approval_evidence_check
        check (status <> 'approved' or approved_at is not null)
);

create index if not exists order_payments_status_updated_idx
    on public.order_payments(status, updated_at desc);
create index if not exists booking_status_history_booking_idx
    on public.booking_status_history(booking_id, created_at desc);
create index if not exists order_status_history_order_idx
    on public.order_status_history(order_id, created_at desc);
create index if not exists order_payment_history_payment_idx
    on public.order_payment_history(payment_id, created_at desc);
create index if not exists photo_download_requests_learner_status_idx
    on public.photo_download_requests(learner_id, status, created_at desc);

create or replace function public.record_booking_status_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
    if tg_op = 'INSERT' or new.status is distinct from old.status
       or new.scheduled_date is distinct from old.scheduled_date
       or new.scheduled_time is distinct from old.scheduled_time then
        insert into public.booking_status_history(
            booking_id, actor_id, old_status, new_status, scheduled_date, scheduled_time, notes
        )
        values (
            new.id,
            auth.uid(),
            case when tg_op = 'INSERT' then null else old.status end,
            new.status,
            new.scheduled_date,
            new.scheduled_time,
            coalesce(new.admin_notes, '')
        );
    end if;
    return new;
end;
$$;

create or replace function public.record_order_status_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
    if tg_op = 'INSERT'
       or new.status is distinct from old.status
       or new.production_status is distinct from old.production_status
       or new.delivery_status is distinct from old.delivery_status then
        insert into public.order_status_history(
            order_id, actor_id, old_status, new_status,
            old_production_status, new_production_status,
            old_delivery_status, new_delivery_status, notes
        )
        values (
            new.id,
            auth.uid(),
            case when tg_op = 'INSERT' then null else old.status end,
            new.status,
            case when tg_op = 'INSERT' then null else old.production_status end,
            new.production_status,
            case when tg_op = 'INSERT' then null else old.delivery_status end,
            new.delivery_status,
            concat_ws(E'\n', nullif(new.admin_notes, ''), nullif(new.delivery_notes, ''))
        );
    end if;
    return new;
end;
$$;

create or replace function public.record_order_payment_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
    if tg_op = 'INSERT' or new.status is distinct from old.status then
        insert into public.order_payment_history(
            payment_id, actor_id, old_status, new_status, payment_reference,
            amount_received_cents, notes
        )
        values (
            new.id,
            auth.uid(),
            case when tg_op = 'INSERT' then null else old.status end,
            new.status,
            new.payment_reference,
            new.amount_received_cents,
            new.admin_notes
        );
    end if;
    return new;
end;
$$;

create or replace function public.enforce_paid_order_fulfilment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    if new.status = 'complete'
       and not exists (
           select 1
           from public.order_payments payment
           where payment.order_id = new.id
             and payment.status = 'verified'
       ) then
        raise exception 'payment must be verified before an order can be completed';
    end if;
    if new.status = 'cancelled'
       and new.status is distinct from old.status
       and length(trim(new.cancellation_reason)) < 3 then
        raise exception 'a cancellation reason is required';
    end if;
    if new.production_status is distinct from old.production_status
       and new.production_status <> 'pending'
       and not exists (
           select 1
           from public.order_payments payment
           where payment.order_id = new.id
             and payment.status = 'verified'
       ) then
        raise exception 'payment must be verified before production';
    end if;
    if new.delivery_status is distinct from old.delivery_status
       and new.delivery_status <> 'not_started'
       and new.production_status <> 'ready' then
        raise exception 'production must be ready before delivery';
    end if;
    return new;
end;
$$;

create or replace function public.enforce_private_photo_publication()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    if new.is_published and (
        new.learner_id is null
        or new.preview_storage_path is null
        or new.is_archived
        or not exists (
            select 1
            from public.learners learner
            where learner.id = new.learner_id
              and learner.is_active
              and learner.consent_status = 'approved'
        )
    ) then
        raise exception 'publishing requires an active learner with approved photo consent and a private preview';
    end if;
    return new;
end;
$$;

create or replace function public.unpublish_photos_without_consent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    if new.is_active is false or new.consent_status is distinct from 'approved' then
        update public.school_photos
        set is_published = false
        where learner_id = new.id
          and is_published;
    end if;
    return new;
end;
$$;

create or replace function public.admin_record_order_payment(
    p_order_id uuid,
    p_status text,
    p_amount_received_cents integer,
    p_payment_reference text,
    p_payment_channel text,
    p_admin_notes text
)
returns public.order_payments
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    expected_cents integer;
    current_payment public.order_payments;
    saved_payment public.order_payments;
begin
    if auth.role() is distinct from 'authenticated' or not public.current_user_is_admin() then
        raise exception 'not authorized';
    end if;
    if p_order_id is null
       or p_status is null
       or p_status not in (
           'awaiting_payment', 'proof_reported', 'under_verification',
           'verified', 'rejected', 'refunded'
       )
       or p_amount_received_cents is null
       or p_amount_received_cents < 0
       or p_payment_reference is null
       or length(p_payment_reference) > 200
       or p_payment_channel is null
       or p_payment_channel not in ('bank_transfer', 'cash', 'other')
       or p_admin_notes is null
       or length(p_admin_notes) > 5000 then
        raise exception 'invalid payment update';
    end if;

    if not exists (select 1 from public.parent_orders where id = p_order_id) then
        raise exception 'order not found';
    end if;

    select coalesce(sum(unit_price_cents), 0)::integer into expected_cents
    from public.parent_order_items
    where order_id = p_order_id;

    select * into current_payment
    from public.order_payments
    where order_id = p_order_id
    for update;

    if p_status = 'verified'
       and (
           length(trim(p_payment_reference)) < 3
           or p_amount_received_cents < expected_cents
       ) then
        raise exception 'verified payment requires a transaction reference and the full expected amount';
    end if;
    if p_status = 'refunded'
       and not found then
        raise exception 'only a recorded payment can be marked refunded';
    end if;
    if p_status = 'refunded' and current_payment.status <> 'verified' then
        raise exception 'only a verified payment can be marked refunded';
    end if;
    if current_payment.status = 'verified'
       and p_status <> 'verified'
       and exists (
           select 1
           from public.parent_orders orders
           where orders.id = p_order_id
             and (
                 orders.production_status <> 'pending'
                 or orders.delivery_status <> 'not_started'
             )
       ) then
        raise exception 'payment cannot be changed after production or delivery has started';
    end if;

    if p_status = 'proof_reported' and current_payment.proof_reported_at is null then
        current_payment.proof_reported_at := now();
    end if;

    insert into public.order_payments as existing_payment(
        order_id, status, expected_amount_cents, amount_received_cents,
        payment_reference, payment_channel, proof_reported_at, verified_at,
        verified_by, verified_by_email, admin_notes
    )
    values (
        p_order_id, p_status, expected_cents, p_amount_received_cents,
        trim(p_payment_reference), p_payment_channel,
        case when p_status = 'proof_reported' then coalesce(current_payment.proof_reported_at, now())
             else current_payment.proof_reported_at end,
        case when p_status = 'verified' then now() else null end,
        case when p_status = 'verified' then auth.uid() else null end,
        case when p_status = 'verified' then coalesce(auth.jwt() ->> 'email', '') else '' end,
        trim(p_admin_notes)
    )
    on conflict (order_id) do update
    set status = excluded.status,
        expected_amount_cents = excluded.expected_amount_cents,
        amount_received_cents = excluded.amount_received_cents,
        payment_reference = excluded.payment_reference,
        payment_channel = excluded.payment_channel,
        proof_reported_at = coalesce(existing_payment.proof_reported_at, excluded.proof_reported_at),
        verified_at = excluded.verified_at,
        verified_by = excluded.verified_by,
        verified_by_email = case
            when excluded.status = 'verified' then coalesce(auth.jwt() ->> 'email', '')
            else ''
        end,
        admin_notes = excluded.admin_notes,
        updated_at = now()
    returning * into saved_payment;

    return saved_payment;
end;
$$;

create or replace function public.record_admin_session_activity(p_action text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
    if p_action is null
       or auth.role() is distinct from 'authenticated'
       or not public.current_user_is_admin()
       or p_action not in ('ADMIN_LOGIN', 'ADMIN_LOGOUT') then
        raise exception 'not authorized';
    end if;
    insert into public.admin_audit_log(actor_id, action, resource_table, resource_id)
    values (auth.uid(), p_action, 'admin_session', auth.uid());
end;
$$;

create or replace function public.admin_revoke_learner_sessions(p_learner_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    revoked_count integer;
begin
    if auth.role() is distinct from 'authenticated' or not public.current_user_is_admin() then
        raise exception 'not authorized';
    end if;
    if p_learner_id is null or not exists (
        select 1 from public.learners where id = p_learner_id
    ) then
        raise exception 'learner not found';
    end if;
    update public.parent_sessions
    set revoked_at = now()
    where learner_id = p_learner_id
      and revoked_at is null;
    get diagnostics revoked_count = row_count;
    insert into public.admin_audit_log(actor_id, action, resource_table, resource_id)
    values (auth.uid(), 'REVOKE_PARENT_ACCESS', 'learners', p_learner_id);
    return revoked_count;
end;
$$;

create or replace function public.admin_review_photo_download(
    p_request_id uuid,
    p_approve boolean
)
returns public.photo_download_requests
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    request_row public.photo_download_requests;
    updated_row public.photo_download_requests;
begin
    if auth.role() is distinct from 'authenticated' or not public.current_user_is_admin() then
        raise exception 'not authorized';
    end if;
    select * into request_row
    from public.photo_download_requests
    where id = p_request_id
    for update;
    if not found then
        raise exception 'download request not found';
    end if;
    if p_approve and not exists (
        select 1
        from public.order_payments payment
        where payment.order_id = request_row.order_id
          and payment.status = 'verified'
    ) then
        raise exception 'payment must be verified before approving a download';
    end if;
    update public.photo_download_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        approved_by = case when p_approve then auth.uid() else null end,
        approved_at = case when p_approve then now() else null end,
        updated_at = now()
    where id = p_request_id
    returning * into updated_row;
    return updated_row;
end;
$$;

create or replace function public.consume_photo_download(
    p_request_id uuid,
    p_learner_id uuid
)
returns table (storage_path text, download_count smallint)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    request_row public.photo_download_requests;
    policy text;
    order_status_value text;
    photo_path text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not authorized';
    end if;
    select * into request_row
    from public.photo_download_requests
    where id = p_request_id and learner_id = p_learner_id
    for update;
    if not found or request_row.status <> 'approved' then
        raise exception 'download request is not approved';
    end if;
    if request_row.download_count >= 5 then
        raise exception 'download limit reached';
    end if;

    select settings.download_policy into policy
    from public.studio_settings settings
    where settings.singleton
    limit 1;
    if policy = 'disabled' then
        raise exception 'downloads are disabled';
    end if;

    select orders.status into order_status_value
    from public.parent_orders orders
    where orders.id = request_row.order_id
      and orders.learner_id = p_learner_id;
    if order_status_value is null or order_status_value = 'cancelled' then
        raise exception 'order is not eligible for download';
    end if;
    if not exists (
        select 1 from public.order_payments payment
        where payment.order_id = request_row.order_id
          and payment.status = 'verified'
    ) then
        raise exception 'payment must be verified before download';
    end if;
    if not exists (
        select 1
        from public.learners learner
        join public.school_classes school_class on school_class.id = learner.class_id
        join public.school_projects project on project.id = school_class.project_id
        join public.schools school on school.id = project.school_id
        where learner.id = p_learner_id
          and learner.is_active
          and learner.consent_status = 'approved'
          and project.status = 'active'
          and school.is_active
    ) then
        raise exception 'learner access is not available';
    end if;
    select photo.storage_path into photo_path
    from public.school_photos photo
    join public.parent_order_items item
      on item.photo_id = photo.id
     and item.order_id = request_row.order_id
    where photo.id = request_row.photo_id
      and photo.learner_id = p_learner_id
      and not photo.is_archived;
    if photo_path is null then
        raise exception 'photo is not part of this order';
    end if;

    update public.photo_download_requests
    set download_count = download_count + 1,
        last_downloaded_at = now(),
        updated_at = now()
    where id = p_request_id
    returning photo_download_requests.download_count into request_row.download_count;
    return query select photo_path, request_row.download_count;
end;
$$;

revoke all on function public.record_booking_status_history() from public, anon, authenticated;
revoke all on function public.record_order_status_history() from public, anon, authenticated;
revoke all on function public.record_order_payment_history() from public, anon, authenticated;
revoke all on function public.enforce_booking_schedule() from public, anon, authenticated;
revoke all on function public.enforce_paid_order_fulfilment() from public, anon, authenticated;
revoke all on function public.enforce_private_photo_publication() from public, anon, authenticated;
revoke all on function public.unpublish_photos_without_consent() from public, anon, authenticated;
revoke all on function public.admin_record_order_payment(uuid, text, integer, text, text, text)
    from public, anon;
revoke all on function public.record_admin_session_activity(text) from public, anon;
revoke all on function public.admin_revoke_learner_sessions(uuid) from public, anon;
revoke all on function public.admin_review_photo_download(uuid, boolean) from public, anon;
revoke all on function public.consume_photo_download(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_record_order_payment(uuid, text, integer, text, text, text)
    to authenticated;
grant execute on function public.record_admin_session_activity(text) to authenticated;
grant execute on function public.admin_revoke_learner_sessions(uuid) to authenticated;
grant execute on function public.admin_review_photo_download(uuid, boolean) to authenticated;
grant execute on function public.consume_photo_download(uuid, uuid) to service_role;

drop trigger if exists booking_status_history on public.bookings;
create trigger booking_status_history after insert or update on public.bookings
    for each row execute function public.record_booking_status_history();
drop trigger if exists enforce_booking_schedule on public.bookings;
create trigger enforce_booking_schedule before insert or update on public.bookings
    for each row execute function public.enforce_booking_schedule();
drop trigger if exists order_status_history on public.parent_orders;
create trigger order_status_history after insert or update on public.parent_orders
    for each row execute function public.record_order_status_history();
drop trigger if exists order_payment_history on public.order_payments;
create trigger order_payment_history after insert or update on public.order_payments
    for each row execute function public.record_order_payment_history();
drop trigger if exists enforce_paid_order_fulfilment on public.parent_orders;
create trigger enforce_paid_order_fulfilment before update on public.parent_orders
    for each row execute function public.enforce_paid_order_fulfilment();
drop trigger if exists enforce_private_photo_publication on public.school_photos;
create trigger enforce_private_photo_publication before insert or update on public.school_photos
    for each row execute function public.enforce_private_photo_publication();
drop trigger if exists unpublish_photos_without_consent on public.learners;
create trigger unpublish_photos_without_consent after update of is_active, consent_status on public.learners
    for each row execute function public.unpublish_photos_without_consent();

drop trigger if exists booking_services_set_updated_at on public.booking_services;
create trigger booking_services_set_updated_at before update on public.booking_services
    for each row execute function public.set_updated_at();
drop trigger if exists studio_settings_set_updated_at on public.studio_settings;
create trigger studio_settings_set_updated_at before update on public.studio_settings
    for each row execute function public.set_updated_at();
drop trigger if exists guardians_set_updated_at on public.guardians;
create trigger guardians_set_updated_at before update on public.guardians
    for each row execute function public.set_updated_at();
drop trigger if exists order_payments_set_updated_at on public.order_payments;
create trigger order_payments_set_updated_at before update on public.order_payments
    for each row execute function public.set_updated_at();
drop trigger if exists photo_download_requests_set_updated_at on public.photo_download_requests;
create trigger photo_download_requests_set_updated_at before update on public.photo_download_requests
    for each row execute function public.set_updated_at();

drop trigger if exists booking_services_audit on public.booking_services;
create trigger booking_services_audit after insert or update or delete on public.booking_services
    for each row execute function public.write_admin_audit_log();
drop trigger if exists studio_settings_audit on public.studio_settings;
create trigger studio_settings_audit after insert or update or delete on public.studio_settings
    for each row execute function public.write_admin_audit_log();
drop trigger if exists guardians_audit on public.guardians;
create trigger guardians_audit after insert or update or delete on public.guardians
    for each row execute function public.write_admin_audit_log();
drop trigger if exists learner_guardians_audit on public.learner_guardians;
create trigger learner_guardians_audit after insert or update or delete on public.learner_guardians
    for each row execute function public.write_admin_audit_log();
drop trigger if exists photo_batches_audit on public.photo_batches;
create trigger photo_batches_audit after insert or update or delete on public.photo_batches
    for each row execute function public.write_admin_audit_log();
drop trigger if exists order_payments_audit on public.order_payments;
create trigger order_payments_audit after insert or update or delete on public.order_payments
    for each row execute function public.write_admin_audit_log();
drop trigger if exists photo_download_requests_audit on public.photo_download_requests;
create trigger photo_download_requests_audit after insert or update or delete on public.photo_download_requests
    for each row execute function public.write_admin_audit_log();

alter table public.booking_services enable row level security;
alter table public.studio_settings enable row level security;
alter table public.guardians enable row level security;
alter table public.learner_guardians enable row level security;
alter table public.photo_batches enable row level security;
alter table public.order_payments enable row level security;
alter table public.booking_status_history enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_payment_history enable row level security;
alter table public.photo_download_requests enable row level security;

grant select on public.booking_services to anon, authenticated;
grant insert, update, delete on public.booking_services to authenticated;
grant select, insert, update, delete on
    public.studio_settings,
    public.guardians,
    public.learner_guardians,
    public.photo_batches
to authenticated;
grant select on
    public.order_payments,
    public.booking_status_history,
    public.order_status_history,
    public.order_payment_history,
    public.photo_download_requests
to authenticated;
grant all on
    public.booking_services,
    public.studio_settings,
    public.guardians,
    public.learner_guardians,
    public.photo_batches,
    public.order_payments,
    public.booking_status_history,
    public.order_status_history,
    public.order_payment_history,
    public.photo_download_requests
to service_role;
grant usage, select on sequence
    public.booking_status_history_id_seq,
    public.order_status_history_id_seq,
    public.order_payment_history_id_seq
to service_role;

create policy public_read_active_booking_services on public.booking_services
    for select to anon, authenticated
    using (is_active);
create policy admins_manage_booking_services on public.booking_services
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_studio_settings on public.studio_settings
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_guardians on public.guardians
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_learner_guardians on public.learner_guardians
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_photo_batches on public.photo_batches
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
create policy admins_manage_order_payments on public.order_payments
    for select to authenticated
    using (public.current_user_is_admin());
create policy admins_read_booking_status_history on public.booking_status_history
    for select to authenticated
    using (public.current_user_is_admin());
create policy admins_read_order_status_history on public.order_status_history
    for select to authenticated
    using (public.current_user_is_admin());
create policy admins_read_order_payment_history on public.order_payment_history
    for select to authenticated
    using (public.current_user_is_admin());
create policy admins_manage_photo_download_requests on public.photo_download_requests
    for select to authenticated
    using (public.current_user_is_admin());

drop policy if exists admins_manage_schools on public.schools;
create policy admins_manage_schools on public.schools
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
drop policy if exists admins_manage_projects on public.school_projects;
create policy admins_manage_projects on public.school_projects
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
drop policy if exists admins_manage_classes on public.school_classes;
create policy admins_manage_classes on public.school_classes
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
drop policy if exists admins_manage_learners on public.learners;
create policy admins_manage_learners on public.learners
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
drop policy if exists admins_manage_photos on public.school_photos;
create policy admins_manage_photos on public.school_photos
    for all to authenticated
    using (public.current_user_is_admin())
    with check (public.current_user_is_admin());
