-- ── Knite product catalogue seed (9 cabinet models) ──
-- Upsert: re-running updates existing rows. Removes the legacy 3-SKU catalogue.

DELETE FROM products WHERE slug IN ('knite-shield', 'knite-prime', 'knite-prime-elite', 'knite-prime-silk', 'knite-pure-75', 'knite-copper-alkaline', 'knite-slim-plus', 'knite-ultra-150');

INSERT INTO products
  (slug, sku, name, short_desc, long_desc, mrp, selling_price, weight_kg, warranty_months,
   capacity_litres, features, specs, images, stock, is_active, is_featured, sort_order)
VALUES
(
  'knite-core', 'KNITE-CORE', 'Knite Core',
  '6-stage RO + UV + Alkaline RO purifier in the Core cabinet. 80 GPD, handles TDS up to 1500 ppm.',
  'The Knite Core delivers 6-stage RO + UV + Alkaline purification housed in the distinctive Core cabinet. Its 80 GPD membrane handles input TDS up to 1500 ppm, paired with in-tank uv-led sterilisation, and an alkaline mineral cartridge for balanced, great-tasting water. Includes free pan-India installation and a 1-year comprehensive warranty.',
  11999, 7999, 8.5, 12, 8,
  '["6-stage RO + UV + Alkaline purification", "In-Tank UV-LED sterilisation", "Alkaline mineral cartridge — balanced, mineral-rich water", "80 GPD membrane · handles TDS up to 1500 ppm", "8 litre food-grade storage tank", "Free pan-India installation", "1-year comprehensive warranty"]'::jsonb,
  '{"stages": 6, "purification": "RO + UV + Alkaline", "uv_type": "In-Tank UV-LED", "ultrafiltration": "No", "tds_controller": "Not required", "alkaline_mineral": "Yes", "auto_flush": "No", "membrane_capacity_gpd": 80, "max_tds_ppm": 1500, "tank_capacity_litres": 8, "cabinet": "Onix", "power_w": 30, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "36 x 22 x 47", "weight_kg": 8.5, "warranty": "1 year"}'::jsonb,
  '[{"url": "/shop-img/knite-core.svg", "alt": "Knite Core"}]'::jsonb,
  50, TRUE, TRUE, 1
),
(
  'knite-flux', 'KNITE-FLUX', 'Knite Flux',
  '7-stage RO + UV + UF + MTDS RO purifier in the Flux cabinet. 80 GPD, handles TDS up to 2000 ppm.',
  'The Knite Flux delivers 7-stage RO + UV + UF + MTDS purification housed in the distinctive Flux cabinet. Its 80 GPD membrane handles input TDS up to 2000 ppm, paired with uv barrel (in-line) sterilisation and an ultrafiltration barrier, a manual TDS controller. Includes free pan-India installation and a 1-year comprehensive warranty.',
  11999, 7999, 8.8, 12, 8,
  '["7-stage RO + UV + UF + MTDS purification", "UV Barrel (in-line) sterilisation", "Ultrafiltration (UF) membrane — cyst & bacteria barrier", "Manual TDS controller (MTDS) for mineral balance", "80 GPD membrane · handles TDS up to 2000 ppm", "8 litre food-grade storage tank", "Free pan-India installation", "1-year comprehensive warranty"]'::jsonb,
  '{"stages": 7, "purification": "RO + UV + UF + MTDS", "uv_type": "UV Barrel (in-line)", "ultrafiltration": "Yes", "tds_controller": "Manual (MTDS)", "alkaline_mineral": "No", "auto_flush": "No", "membrane_capacity_gpd": 80, "max_tds_ppm": 2000, "tank_capacity_litres": 8, "cabinet": "Lexter", "power_w": 32, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "37 x 23 x 48", "weight_kg": 8.8, "warranty": "1 year"}'::jsonb,
  '[{"url": "/shop-img/knite-flux.svg", "alt": "Knite Flux"}]'::jsonb,
  50, TRUE, TRUE, 2
),
(
  'knite-flux-white', 'KNITE-FLUX-WHITE', 'Knite Flux White',
  '7-stage RO + UV + UF + MTDS RO purifier in the Flux White cabinet. 80 GPD, handles TDS up to 2000 ppm.',
  'The Knite Flux White delivers 7-stage RO + UV + UF + MTDS purification in a clean white Flux cabinet. Its 80 GPD membrane handles input TDS up to 2000 ppm, paired with uv barrel (in-line) sterilisation and an ultrafiltration barrier, a manual TDS controller. Includes free pan-India installation and a 1-year comprehensive warranty.',
  11999, 7999, 8.8, 12, 8,
  '["7-stage RO + UV + UF + MTDS purification", "UV Barrel (in-line) sterilisation", "Ultrafiltration (UF) membrane — cyst & bacteria barrier", "Manual TDS controller (MTDS) for mineral balance", "80 GPD membrane · handles TDS up to 2000 ppm", "8 litre food-grade storage tank", "Free pan-India installation", "1-year comprehensive warranty"]'::jsonb,
  '{"stages": 7, "purification": "RO + UV + UF + MTDS", "uv_type": "UV Barrel (in-line)", "ultrafiltration": "Yes", "tds_controller": "Manual (MTDS)", "alkaline_mineral": "No", "auto_flush": "No", "membrane_capacity_gpd": 80, "max_tds_ppm": 2000, "tank_capacity_litres": 8, "cabinet": "Flux White", "power_w": 32, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "37 x 23 x 48", "weight_kg": 8.8, "warranty": "1 year"}'::jsonb,
  '[{"url": "/products/knite-flux-white.jpg", "alt": "Knite Flux White"}]'::jsonb,
  50, TRUE, TRUE, 3
),
(
  'knite-prime-white', 'KNITE-PRIME-WHITE', 'Knite Prime White',
  '6-stage RO + UV + Alkaline RO purifier in the Prime White cabinet. 100 GPD, handles TDS up to 3000 ppm.',
  'The Knite Prime White delivers 6-stage RO + UV + Alkaline purification in a clean white Prime cabinet. Its 100 GPD membrane handles input TDS up to 3000 ppm, paired with in-tank uv-led sterilisation, and an alkaline mineral cartridge for balanced, great-tasting water. Includes free pan-India installation and a 2-year comprehensive warranty with free filter replacements.',
  14999, 9999, 9.4, 24, 10,
  '["6-stage RO + UV + Alkaline purification", "In-Tank UV-LED sterilisation", "Alkaline mineral cartridge — balanced, mineral-rich water", "100 GPD membrane · handles TDS up to 3000 ppm", "10 litre food-grade storage tank", "Auto-flush membrane protection (longer membrane life)", "Free pan-India installation", "2-year comprehensive warranty + free filter replacements"]'::jsonb,
  '{"stages": 6, "purification": "RO + UV + Alkaline", "uv_type": "In-Tank UV-LED", "ultrafiltration": "No", "tds_controller": "Not required", "alkaline_mineral": "Yes", "auto_flush": "Yes", "membrane_capacity_gpd": 100, "max_tds_ppm": 3000, "tank_capacity_litres": 10, "cabinet": "Prime White", "power_w": 36, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "38 x 24 x 49", "weight_kg": 9.4, "warranty": "2 years"}'::jsonb,
  '[{"url": "/products/knite-prime-white.jpg", "alt": "Knite Prime White"}]'::jsonb,
  50, TRUE, TRUE, 4
),
(
  'knite-prime-black', 'KNITE-PRIME-BLACK', 'Knite Prime Black',
  '6-stage RO + UV + Alkaline RO purifier in the Prime Black cabinet. 100 GPD, handles TDS up to 3000 ppm.',
  'The Knite Prime Black delivers 6-stage RO + UV + Alkaline purification in a premium black Prime cabinet. Its 100 GPD membrane handles input TDS up to 3000 ppm, paired with in-tank uv-led sterilisation, and an alkaline mineral cartridge for balanced, great-tasting water. Includes free pan-India installation and a 2-year comprehensive warranty with free filter replacements.',
  14999, 9999, 9.4, 24, 10,
  '["6-stage RO + UV + Alkaline purification", "In-Tank UV-LED sterilisation", "Alkaline mineral cartridge — balanced, mineral-rich water", "100 GPD membrane · handles TDS up to 3000 ppm", "10 litre food-grade storage tank", "Auto-flush membrane protection (longer membrane life)", "Free pan-India installation", "2-year comprehensive warranty + free filter replacements"]'::jsonb,
  '{"stages": 6, "purification": "RO + UV + Alkaline", "uv_type": "In-Tank UV-LED", "ultrafiltration": "No", "tds_controller": "Not required", "alkaline_mineral": "Yes", "auto_flush": "Yes", "membrane_capacity_gpd": 100, "max_tds_ppm": 3000, "tank_capacity_litres": 10, "cabinet": "Prime Black", "power_w": 36, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "38 x 24 x 49", "weight_kg": 9.4, "warranty": "2 years"}'::jsonb,
  '[{"url": "/products/knite-prime-black.jpg", "alt": "Knite Prime Black"}]'::jsonb,
  50, TRUE, TRUE, 5
),
(
  'knite-shield-copper', 'KNITE-SHIELD-COPPER', 'Knite Shield Copper',
  '6-stage RO + UV + Alkaline RO purifier in the Shield Copper cabinet. 100 GPD, handles TDS up to 3000 ppm.',
  'The Knite Shield Copper delivers 6-stage RO + UV + Alkaline purification housed in the distinctive Shield Copper cabinet. Its 100 GPD membrane handles input TDS up to 3000 ppm, paired with in-tank uv-led sterilisation, and an alkaline mineral cartridge for balanced, great-tasting water. Includes free pan-India installation and a 2-year comprehensive warranty with free filter replacements.',
  14999, 10499, 9.4, 24, 10,
  '["6-stage RO + UV + Alkaline purification", "In-Tank UV-LED sterilisation", "Alkaline mineral cartridge — balanced, mineral-rich water", "100 GPD membrane · handles TDS up to 3000 ppm", "10 litre food-grade storage tank", "Auto-flush membrane protection (longer membrane life)", "Free pan-India installation", "2-year comprehensive warranty + free filter replacements"]'::jsonb,
  '{"stages": 6, "purification": "RO + UV + Alkaline", "uv_type": "In-Tank UV-LED", "ultrafiltration": "No", "tds_controller": "Not required", "alkaline_mineral": "Yes", "auto_flush": "Yes", "membrane_capacity_gpd": 100, "max_tds_ppm": 3000, "tank_capacity_litres": 10, "cabinet": "Canix Elite", "power_w": 36, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "38 x 24 x 49", "weight_kg": 9.4, "warranty": "2 years"}'::jsonb,
  '[{"url": "/shop-img/knite-shield-copper.svg", "alt": "Knite Shield Copper"}]'::jsonb,
  50, TRUE, FALSE, 6
),
(
  'knite-shield-silver', 'KNITE-SHIELD-SILVER', 'Knite Shield Silver',
  '6-stage RO + UV + Alkaline RO purifier in the Shield Silver cabinet. 100 GPD, handles TDS up to 3000 ppm.',
  'The Knite Shield Silver delivers 6-stage RO + UV + Alkaline purification housed in the distinctive Shield Silver cabinet. Its 100 GPD membrane handles input TDS up to 3000 ppm, paired with in-tank uv-led sterilisation, and an alkaline mineral cartridge for balanced, great-tasting water. Includes free pan-India installation and a 2-year comprehensive warranty with free filter replacements.',
  16999, 11499, 9.8, 24, 12,
  '["6-stage RO + UV + Alkaline purification", "In-Tank UV-LED sterilisation", "Alkaline mineral cartridge — balanced, mineral-rich water", "100 GPD membrane · handles TDS up to 3000 ppm", "12 litre food-grade storage tank", "Auto-flush membrane protection (longer membrane life)", "Free pan-India installation", "2-year comprehensive warranty + free filter replacements"]'::jsonb,
  '{"stages": 6, "purification": "RO + UV + Alkaline", "uv_type": "In-Tank UV-LED", "ultrafiltration": "No", "tds_controller": "Not required", "alkaline_mineral": "Yes", "auto_flush": "Yes", "membrane_capacity_gpd": 100, "max_tds_ppm": 3000, "tank_capacity_litres": 12, "cabinet": "Canix Metallic", "power_w": 36, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "40 x 25 x 52", "weight_kg": 9.8, "warranty": "2 years"}'::jsonb,
  '[{"url": "/shop-img/knite-shield-silver.svg", "alt": "Knite Shield Silver"}]'::jsonb,
  50, TRUE, FALSE, 7
),
(
  'knite-edge-black', 'KNITE-EDGE-BLACK', 'Knite Edge Black',
  '6-stage RO + UV + Alkaline RO purifier in the Edge Black cabinet. 100 GPD, handles TDS up to 3000 ppm.',
  'The Knite Edge Black delivers 6-stage RO + UV + Alkaline purification housed in the distinctive Edge Black cabinet. Its 100 GPD membrane handles input TDS up to 3000 ppm, paired with in-tank uv-led sterilisation, and an alkaline mineral cartridge for balanced, great-tasting water. Includes free pan-India installation and a 2-year comprehensive warranty with free filter replacements.',
  14999, 10499, 9.4, 24, 10,
  '["6-stage RO + UV + Alkaline purification", "In-Tank UV-LED sterilisation", "Alkaline mineral cartridge — balanced, mineral-rich water", "100 GPD membrane · handles TDS up to 3000 ppm", "10 litre food-grade storage tank", "Auto-flush membrane protection (longer membrane life)", "Free pan-India installation", "2-year comprehensive warranty + free filter replacements"]'::jsonb,
  '{"stages": 6, "purification": "RO + UV + Alkaline", "uv_type": "In-Tank UV-LED", "ultrafiltration": "No", "tds_controller": "Not required", "alkaline_mineral": "Yes", "auto_flush": "Yes", "membrane_capacity_gpd": 100, "max_tds_ppm": 3000, "tank_capacity_litres": 10, "cabinet": "IRIS Elite", "power_w": 36, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "38 x 24 x 49", "weight_kg": 9.4, "warranty": "2 years"}'::jsonb,
  '[{"url": "/shop-img/knite-edge-black.svg", "alt": "Knite Edge Black"}]'::jsonb,
  50, TRUE, FALSE, 8
),
(
  'knite-edge-silver', 'KNITE-EDGE-SILVER', 'Knite Edge Silver',
  '6-stage RO + UV + Alkaline RO purifier in the Edge Silver cabinet. 100 GPD, handles TDS up to 3000 ppm.',
  'The Knite Edge Silver delivers 6-stage RO + UV + Alkaline purification housed in the distinctive Edge Silver cabinet. Its 100 GPD membrane handles input TDS up to 3000 ppm, paired with in-tank uv-led sterilisation, and an alkaline mineral cartridge for balanced, great-tasting water. Includes free pan-India installation and a 2-year comprehensive warranty with free filter replacements.',
  16999, 11499, 9.8, 24, 12,
  '["6-stage RO + UV + Alkaline purification", "In-Tank UV-LED sterilisation", "Alkaline mineral cartridge — balanced, mineral-rich water", "100 GPD membrane · handles TDS up to 3000 ppm", "12 litre food-grade storage tank", "Auto-flush membrane protection (longer membrane life)", "Free pan-India installation", "2-year comprehensive warranty + free filter replacements"]'::jsonb,
  '{"stages": 6, "purification": "RO + UV + Alkaline", "uv_type": "In-Tank UV-LED", "ultrafiltration": "No", "tds_controller": "Not required", "alkaline_mineral": "Yes", "auto_flush": "Yes", "membrane_capacity_gpd": 100, "max_tds_ppm": 3000, "tank_capacity_litres": 12, "cabinet": "IRIS Metallic", "power_w": 36, "voltage_v": "100-240 AC", "installation": "Counter-top / Wall-mount", "dimensions_cm": "40 x 25 x 52", "weight_kg": 9.8, "warranty": "2 years"}'::jsonb,
  '[{"url": "/shop-img/knite-edge-silver.svg", "alt": "Knite Edge Silver"}]'::jsonb,
  50, TRUE, FALSE, 9
)
ON CONFLICT (slug) DO UPDATE SET
  sku=EXCLUDED.sku, name=EXCLUDED.name, short_desc=EXCLUDED.short_desc,
  long_desc=EXCLUDED.long_desc, mrp=EXCLUDED.mrp, selling_price=EXCLUDED.selling_price,
  weight_kg=EXCLUDED.weight_kg, warranty_months=EXCLUDED.warranty_months,
  capacity_litres=EXCLUDED.capacity_litres, features=EXCLUDED.features,
  specs=EXCLUDED.specs, images=EXCLUDED.images, stock=EXCLUDED.stock,
  is_active=EXCLUDED.is_active, is_featured=EXCLUDED.is_featured,
  sort_order=EXCLUDED.sort_order, updated_at=NOW();
