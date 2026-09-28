-- Procurement controls for the stock control matrix.
-- Fudo remains the source of truth for quantities; these fields drive LVE alerts and purchasing UX.

alter table public.stock_items
  add column if not exists purchase_lead_time_days integer;

do $$
begin
  alter table public.stock_items
    add constraint stock_items_purchase_lead_time_days_check
    check (
      purchase_lead_time_days is null
      or (purchase_lead_time_days >= 0 and purchase_lead_time_days <= 60)
    );
exception
  when duplicate_object then null;
end $$;

comment on column public.stock_items.purchase_lead_time_days is
  'Days of notice needed before ordering this stock item from its supplier. Used by LVE stock alerts; does not overwrite Fudo quantity.';
