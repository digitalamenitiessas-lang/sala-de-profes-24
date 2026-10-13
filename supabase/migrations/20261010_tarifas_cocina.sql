-- Tarifas (Marco, 10/10/2026, corrige la anterior): ayudante de cocina $4.000;
-- chef $4.200 (Melina y Gastón).
update public.payroll_rates set hourly_rate = 4000, label = 'Ayudante de cocina', updated_at = now() where role = 'cocina';
update public.payroll_rates set hourly_rate = 4200, label = 'Chef', updated_at = now() where role = 'chef';
