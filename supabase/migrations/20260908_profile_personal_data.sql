-- Datos personales del perfil de empleado/socio
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cuit                    TEXT,
  ADD COLUMN IF NOT EXISTS address                 TEXT,
  ADD COLUMN IF NOT EXISTS dni                     TEXT,
  ADD COLUMN IF NOT EXISTS birth_date              DATE,
  ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
