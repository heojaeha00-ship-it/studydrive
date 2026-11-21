-- 스터디드라이브 DB 스키마 (Supabase SQL Editor에 전체 붙여넣고 Run)

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  path text not null,
  mime text default '',
  size bigint default 0,
  category text default '미분류',
  tags text[] default '{}',
  summary text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.annotations (
  file_id uuid not null references public.files on delete cascade,
  page int not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  strokes jsonb not null default '[]',
  updated_at timestamptz default now(),
  primary key (file_id, page)
);

create table if not exists public.mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  file_id uuid references public.files on delete set null,
  file_name text,
  page int default 1,
  label text not null,
  reason text default '기타',
  memo text default '',
  stage int default 0,
  next_review date default (current_date + 1),
  graduated boolean default false,
  last_result text,
  ai jsonb,
  created_at timestamptz default now()
);

alter table public.files enable row level security;
alter table public.annotations enable row level security;
alter table public.mistakes enable row level security;

create policy "own files" on public.files for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own annotations" on public.annotations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own mistakes" on public.mistakes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- AI 하루 사용량 제한 (비용 보호). 클라이언트는 테이블에 직접 접근 못 함.
create table if not exists public.ai_usage (
  user_id uuid not null,
  day date not null default current_date,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

create or replace function public.hit_ai_usage(max_n int) returns boolean
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into public.ai_usage(user_id, day, n) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set n = public.ai_usage.n + 1
  returning n into c;
  return c <= max_n;
end $$;
revoke all on function public.hit_ai_usage(int) from public;
grant execute on function public.hit_ai_usage(int) to authenticated;

-- 파일 저장소 (비공개, 사용자별 폴더)
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800) on conflict (id) do nothing;

create policy "files select own" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "files insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "files update own" on storage.objects for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "files delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
