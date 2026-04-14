-- Knite Platform Seed Data
-- Delhi NCR Zones

INSERT INTO zones (id, name, city, pincodes) VALUES
  ('11111111-0000-0000-0000-000000000001', 'South Delhi', 'Delhi NCR', ARRAY['110017','110019','110020','110021','110022','110023','110024','110025','110047','110048','110049']),
  ('11111111-0000-0000-0000-000000000002', 'North Delhi', 'Delhi NCR', ARRAY['110006','110007','110009','110054','110084']),
  ('11111111-0000-0000-0000-000000000003', 'East Delhi', 'Delhi NCR', ARRAY['110091','110092','110093','110095','110096']),
  ('11111111-0000-0000-0000-000000000004', 'West Delhi', 'Delhi NCR', ARRAY['110018','110026','110027','110041','110046','110058','110059','110063']),
  ('11111111-0000-0000-0000-000000000005', 'Noida Sector 1-49', 'Delhi NCR', ARRAY['201301','201302','201303','201304','201305']),
  ('11111111-0000-0000-0000-000000000006', 'Noida Sector 50-80', 'Delhi NCR', ARRAY['201301','201306','201307','201309','201310']),
  ('11111111-0000-0000-0000-000000000007', 'Greater Noida', 'Delhi NCR', ARRAY['201310','201312','201313','201314','201315']),
  ('11111111-0000-0000-0000-000000000008', 'Gurgaon Phase 1', 'Delhi NCR', ARRAY['122001','122002','122003','122004','122007','122009']),
  ('11111111-0000-0000-0000-000000000009', 'Gurgaon Phase 2', 'Delhi NCR', ARRAY['122010','122011','122015','122016','122017','122018']),
  ('11111111-0000-0000-0000-000000000010', 'Ghaziabad', 'Delhi NCR', ARRAY['201001','201002','201003','201004','201005','201006']);

-- Demo Units (shipped, ready to be activated by customer)
INSERT INTO units (unit_id, status, model) VALUES
  ('KN-8492', 'shipped', 'Knite RO Standard'),
  ('KN-7201', 'shipped', 'Knite RO Standard'),
  ('KN-1337', 'shipped', 'Knite RO Plus'),
  ('KN-0042', 'shipped', 'Knite RO Standard'),
  ('KN-5500', 'shipped', 'Knite RO Plus');

-- Demo Technician (pre-approved for testing)
INSERT INTO customers (phone, name) VALUES
  ('919999999999', 'Test Admin');

INSERT INTO technicians (id, phone, name, home_zone_id, is_verified, is_active, rating, bank_upi)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '918888888888',
  'Ramesh Kumar (Demo Tech)',
  '11111111-0000-0000-0000-000000000006',
  true,
  true,
  4.8,
  'ramesh@upi'
);

INSERT INTO technician_zones (technician_id, zone_id, is_home) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000006', true),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000005', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000007', false);

-- Second demo technician in Gurgaon
INSERT INTO technicians (id, phone, name, home_zone_id, is_verified, is_active, rating, bank_upi)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000002',
  '917777777777',
  'Suresh Sharma (Demo Tech)',
  '11111111-0000-0000-0000-000000000008',
  true,
  true,
  4.5,
  'suresh@upi'
);

INSERT INTO technician_zones (technician_id, zone_id, is_home) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000008', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000009', false);
