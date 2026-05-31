-- ── Knite product catalogue seed ──
-- Idempotent: ON CONFLICT (slug) DO NOTHING so re-running is safe.

INSERT INTO products
  (slug, sku, name, short_desc, long_desc, mrp, selling_price, weight_kg, warranty_months,
   capacity_litres, features, specs, images, stock, is_active, is_featured, sort_order)
VALUES
(
  'knite-pure-75',
  'KNITE-PRO-75',
  'Knite Pure 75 GPD RO Water Purifier',
  '7-stage RO + UV + UF purification with copper-alkaline tech. Ideal for families of 2-4.',
  'Knite Pure 75 delivers premium 7-stage purification combining Reverse Osmosis, Ultraviolet sterilisation, and Ultra-Filtration with a signature copper-alkaline cartridge. Built for Indian water conditions — handles TDS up to 2000 ppm. Comes with free pan-India installation and a 1-year comprehensive warranty.',
  19999, 14999, 9.5, 12, 10,
  '["7-stage RO + UV + UF purification","Copper-alkaline cartridge","TDS up to 2000 ppm","10 litre storage tank","Smart filter-life indicator","Free pan-India installation","1-year comprehensive warranty"]'::jsonb,
  '{"stages":7,"tank_capacity_litres":10,"membrane_capacity_gpd":75,"max_tds_ppm":2000,"power_w":36,"voltage_v":"100-240 AC","installation":"Counter-top / Wall-mount","dimensions_cm":"38 x 23 x 50","weight_kg":9.5}'::jsonb,
  '[{"url":"/shop-img/knite-pure-75.svg","alt":"Knite Pure 75 RO Water Purifier"}]'::jsonb,
  25, TRUE, TRUE, 1
),
(
  'knite-copper-alkaline',
  'KNITE-COPPER-ALK',
  'Knite Copper Alkaline RO Water Purifier',
  'Copper-infused alkaline RO with mineral retention. pH 8.5-9.0 balanced water.',
  'Knite Copper Alkaline takes purification one step further with a food-grade copper cartridge that infuses controlled copper ions and balanced alkaline minerals (pH 8.5-9.0) into every glass. Backed by science, designed for daily wellness. Includes the full 7-stage RO + UV + UF tech.',
  21999, 17499, 10.5, 12, 12,
  '["8-stage RO + UV + UF + Copper-Alkaline","Food-grade copper infusion","pH 8.5-9.0 alkaline water","12 litre storage tank","Mineral retention technology","TDS controller","Free pan-India installation","1-year warranty"]'::jsonb,
  '{"stages":8,"tank_capacity_litres":12,"membrane_capacity_gpd":75,"max_tds_ppm":2000,"power_w":40,"voltage_v":"100-240 AC","installation":"Counter-top / Wall-mount","dimensions_cm":"40 x 25 x 52","weight_kg":10.5,"copper_cartridge":"Food-grade","ph_range":"8.5-9.0"}'::jsonb,
  '[{"url":"/shop-img/knite-copper.svg","alt":"Knite Copper Alkaline RO Water Purifier"}]'::jsonb,
  20, TRUE, TRUE, 2
),
(
  'knite-slim-plus',
  'KNITE-SLIM-PLUS',
  'Knite Slim+ Compact Wall-Mount RO Water Purifier',
  'Slim wall-mount RO for compact kitchens. Premium build, premium taste.',
  'Knite Slim+ is engineered for modern Indian kitchens with limited counter space. Its sleek wall-mount design saves space without compromising on purification — full 7-stage RO + UV + UF with smart filter alerts. Perfect for couples or small families.',
  16999, 12499, 7.8, 12, 8,
  '["7-stage RO + UV + UF","Slim wall-mount design","8 litre storage tank","Smart filter alerts","Quiet operation (<45 dB)","Auto shut-off","Free installation","1-year warranty"]'::jsonb,
  '{"stages":7,"tank_capacity_litres":8,"membrane_capacity_gpd":50,"max_tds_ppm":1500,"power_w":24,"voltage_v":"100-240 AC","installation":"Wall-mount","dimensions_cm":"32 x 18 x 45","weight_kg":7.8,"noise_db":"<45"}'::jsonb,
  '[{"url":"/shop-img/knite-slim.svg","alt":"Knite Slim+ Compact RO Water Purifier"}]'::jsonb,
  30, TRUE, FALSE, 3
),
(
  'knite-ultra-150',
  'KNITE-ULTRA-150',
  'Knite Ultra 150 GPD RO Water Purifier with UV + Alkaline',
  'High-capacity RO for large families and offices. 150 GPD output, 15 L tank.',
  'Knite Ultra 150 is engineered for households or commercial spaces with high water demand. The 150 GPD membrane and 15-litre storage tank mean you never run out. Combined with UV sterilisation, alkaline mineralisation, and a robust copper-infused stage for daily wellness.',
  27999, 21999, 12.5, 12, 15,
  '["8-stage RO + UV + UF + Copper + Alkaline","150 GPD membrane (high-capacity)","15 litre storage tank","Suitable for 5+ users / offices","Digital TDS display","Auto filter-change reminder","Free pan-India installation","1-year comprehensive warranty"]'::jsonb,
  '{"stages":8,"tank_capacity_litres":15,"membrane_capacity_gpd":150,"max_tds_ppm":2500,"power_w":48,"voltage_v":"100-240 AC","installation":"Wall-mount / Floor","dimensions_cm":"42 x 28 x 56","weight_kg":12.5,"digital_display":true}'::jsonb,
  '[{"url":"/shop-img/knite-ultra.svg","alt":"Knite Ultra 150 RO Water Purifier"}]'::jsonb,
  15, TRUE, TRUE, 4
)
ON CONFLICT (slug) DO NOTHING;
