-- Amount is optional: some vouchers are a benefit or perk rather than a monetary credit.
alter table public.vouchers alter column amount drop not null;
