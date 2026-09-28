-- Production review workflow.
-- Chefs submit production as pending_review; managers approve it before stock/Fudo is changed.

alter table public.production_orders
  drop constraint if exists production_orders_status_check;

alter table public.production_orders
  add constraint production_orders_status_check
  check (status in ('draft', 'in_progress', 'pending_review', 'completed', 'cancelled'));

alter table public.production_orders
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text;

create index if not exists idx_prod_orders_pending_review
  on public.production_orders(created_at desc)
  where status = 'pending_review';

comment on column public.production_orders.submitted_at is
  'When the chef submitted this production for manager validation.';
comment on column public.production_orders.reviewed_by is
  'Manager/socio who approved the production before stock and Fudo were changed.';
comment on column public.production_orders.reviewed_at is
  'When the production was approved.';
comment on column public.production_orders.review_notes is
  'Manager validation notes.';
