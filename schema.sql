-- ============================================================
-- Outreach Tracker - Supabase schema
-- شغّل الكود ده كله مرة واحدة في: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- التصنيفات (صالون / عيادة / فندق ...) ----------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- ---------- جهات الاتصال ----------
create table if not exists public.contacts (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique,          -- رقم دولي بالأرقام فقط، مثال: 201001234567
  name            text,
  location        text,                          -- العنوان/الموقع لو موجود
  city            text,
  category        text not null,                 -- صالون / عيادة / فندق
  status          text not null default 'new'
                    check (status in ('new','claimed','sent','replied','no_answer')),
  claimed_by      uuid references auth.users(id),
  claimed_by_email text,
  claimed_at      timestamptz,
  sent_by         uuid references auth.users(id),
  sent_by_email   text,
  sent_at         timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists contacts_status_idx   on public.contacts(status);
create index if not exists contacts_category_idx on public.contacts(category);
create index if not exists contacts_city_idx     on public.contacts(city);

-- تحديث updated_at تلقائيًا
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- تصنيف افتراضي
insert into public.categories (name) values ('صالون') on conflict do nothing;

-- ---------- حجز رقم بشكل آمن (يمنع إن اتنين ياخدوا نفس الرقم) ----------
-- بيحجز الرقم باسم اللي بيتصل بس لو لسه 'new'. بيرجّع الصف لو نجح الحجز.
create or replace function public.claim_contact(contact_id uuid)
returns public.contacts as $$
  update public.contacts
     set status = 'claimed',
         claimed_by = auth.uid(),
         claimed_by_email = (select email from auth.users where id = auth.uid()),
         claimed_at = now()
   where id = contact_id
     and status = 'new'
  returning *;
$$ language sql security definer;

-- ============================================================
-- RLS: أي عضو مسجّل دخول يقدر يقرأ/يضيف/يعدّل
-- ============================================================
alter table public.contacts   enable row level security;
alter table public.categories enable row level security;

drop policy if exists "read contacts"   on public.contacts;
drop policy if exists "insert contacts" on public.contacts;
drop policy if exists "update contacts" on public.contacts;
create policy "read contacts"   on public.contacts for select to authenticated using (true);
create policy "insert contacts" on public.contacts for insert to authenticated with check (true);
create policy "update contacts" on public.contacts for update to authenticated using (true) with check (true);

drop policy if exists "read categories"   on public.categories;
drop policy if exists "insert categories" on public.categories;
create policy "read categories"   on public.categories for select to authenticated using (true);
create policy "insert categories" on public.categories for insert to authenticated with check (true);

-- تفعيل التحديث اللحظي (Realtime) على جدول contacts
alter publication supabase_realtime add table public.contacts;
