-- ============================================================================
-- Installer Work Management Platform — Migration 010
-- Seed data: sales divisions carried over from the existing account list.
-- ============================================================================

INSERT INTO public.sales_divisions (code, name, sort_order) VALUES
  ('ivp', 'IVP', 1),
  ('mvi', 'MVI', 2),
  ('mlds', 'MLDS', 3),
  ('havs', 'HAVS', 4),
  ('enterprise', 'Enterprise', 5),
  ('dec', 'DEC', 6),
  ('ics', 'ICS', 7),
  ('poj', 'POJ', 8),
  ('voj', 'VOJ', 9),
  ('locos', 'LOCOS', 10),
  ('visionmedia', 'VISIONMEDIA', 11),
  ('ump', 'UMP', 12),
  ('bisol', 'BISOL', 13),
  ('kims', 'KIMS', 14),
  ('idc', 'IDC', 15),
  ('iocmedan', 'IOCMEDAN', 16),
  ('iocpekanbaru', 'IOCPekanbaru', 17),
  ('iocbandung', 'IOCBandung', 18),
  ('iocjateng', 'IOCJATENG', 19),
  ('iocsemarang', 'IOCSEMARANG', 20),
  ('possurabaya', 'POSSurabaya', 21),
  ('iocsurabaya', 'IOCSurabaya', 22),
  ('iocbali', 'IOCBali', 23),
  ('sgp', 'SGP', 24),
  ('sgp_1', 'SGP 1', 25),
  ('sgp_2', 'SGP 2', 26),
  ('oss', 'OSS', 27)
ON CONFLICT (code) DO NOTHING;
