-- Dummy reviews seed — only inserts if table is empty for that product
DO $$
DECLARE
  core_id   BIGINT;
  shield_id BIGINT;
  prime_id  BIGINT;
BEGIN
  SELECT id INTO core_id   FROM products WHERE slug = 'knite-core'   LIMIT 1;
  SELECT id INTO shield_id FROM products WHERE slug = 'knite-shield' LIMIT 1;
  SELECT id INTO prime_id  FROM products WHERE slug = 'knite-prime'  LIMIT 1;

  -- Only seed if no reviews yet
  IF (SELECT COUNT(*) FROM shop_reviews) = 0 THEN

    -- ───── Knite Core (essential 7-stage) ─────
    INSERT INTO shop_reviews (product_id, reviewer_name, reviewer_city, rating, title, body, is_verified, created_at) VALUES
    (core_id, 'Rohan Mehta',      'Bengaluru',  5, 'Crisp, clean water from day one', 'Installation was quick (1 hour) and the technician was very polite. Water tastes much better than my old purifier. Great value for ₹7,999.', TRUE, now() - INTERVAL '12 days'),
    (core_id, 'Anjali Sharma',    'Pune',       5, 'Perfect for a small family',       'We are 3 people and this fits perfectly. The TDS came down from 380 to 65. Worth every rupee.', TRUE, now() - INTERVAL '23 days'),
    (core_id, 'Vikram Iyer',      'Chennai',    4, 'Solid build, slight delivery delay', 'Build quality feels premium. Took 5 days to deliver instead of 3 but installation team made up for it with a great service. 4 stars.', TRUE, now() - INTERVAL '34 days'),
    (core_id, 'Sneha Patel',      'Ahmedabad',  5, 'Best decision this year',          'Stopped buying bottled water entirely. Saving ₹1500 every month. ROI in 6 months.', TRUE, now() - INTERVAL '45 days'),
    (core_id, 'Karthik Reddy',    'Hyderabad',  5, 'UV lamp is bright and effective',   'You can actually see the UV chamber working. Water comes out clear, no smell, no aftertaste. Recommend.', TRUE, now() - INTERVAL '58 days'),
    (core_id, 'Pooja Singh',      'Lucknow',    4, 'Good for borewell water too',       'Our borewell water had heavy iron taste. Knite Core handles it well, though you can hear the pump a bit at night.', TRUE, now() - INTERVAL '72 days'),
    (core_id, 'Aditya Kumar',     'Patna',      5, 'Customer service is top notch',     'Had a small leak in the inlet pipe, technician came next day and fixed it free of cost. Genuine warranty service.', TRUE, now() - INTERVAL '90 days');

    -- ───── Knite Shield (8-stage + UF + mineraliser) ─────
    INSERT INTO shop_reviews (product_id, reviewer_name, reviewer_city, rating, title, body, is_verified, created_at) VALUES
    (shield_id, 'Meera Krishnan',   'Mumbai',    5, 'Worth the upgrade over basic RO', 'I had a cheap RO earlier — totally different experience. The UF stage really makes water taste sweeter. 12L tank is more than enough for our family of 5.', TRUE, now() - INTERVAL '8 days'),
    (shield_id, 'Arjun Nair',       'Kochi',     5, 'Best RO under 10k',              'Compared with Kent and Aquaguard. Knite Shield wins on price + features. Mineraliser is a real difference.', TRUE, now() - INTERVAL '15 days'),
    (shield_id, 'Divya Joshi',      'Indore',    5, 'Tank size is a game-changer',     '12L means no more waiting during dinner rush. Whole family loves it. The digital display is a nice touch.', TRUE, now() - INTERVAL '27 days'),
    (shield_id, 'Rahul Verma',      'Delhi',     4, 'Great purifier, app could be better', 'Water quality is excellent. Only minor gripe — there is no mobile app to track filter life. Otherwise perfect.', TRUE, now() - INTERVAL '40 days'),
    (shield_id, 'Kavya Bhat',       'Mangalore', 5, 'Coastal water no problem',         'We get hard, slightly salty water near the coast. Shield handles it beautifully. TDS reading shows 50ppm consistently.', TRUE, now() - INTERVAL '52 days'),
    (shield_id, 'Sandeep Gupta',    'Jaipur',    5, 'Installation in 45 minutes',       'Tech arrived on time, very professional. Showed me how each stage works. Now I feel confident about water quality.', TRUE, now() - INTERVAL '63 days'),
    (shield_id, 'Neha Malhotra',    'Chandigarh',5, 'Recommended by my doctor',         'My doctor suggested mineraliser-enabled RO. Knite Shield was the best in budget. Family health has improved noticeably.', TRUE, now() - INTERVAL '78 days'),
    (shield_id, 'Tanvi Desai',      'Surat',     4, 'Auto-flush feature is great',     'Auto-flush keeps the membrane clean. Stage indicators make maintenance easy. Slightly bigger than I expected — measure your kitchen first.', TRUE, now() - INTERVAL '95 days');

    -- ───── Knite Prime (9-stage flagship + copper + alkaline) ─────
    INSERT INTO shop_reviews (product_id, reviewer_name, reviewer_city, rating, title, body, is_verified, created_at) VALUES
    (prime_id, 'Priya Iyengar',     'Bengaluru',  5, 'Copper + alkaline = next level', 'Water tastes like fresh natural spring water. The copper chamber gives it that subtle earthy quality. Worth every paisa of ₹9,999.', TRUE, now() - INTERVAL '6 days'),
    (prime_id, 'Suresh Pillai',     'Trivandrum', 5, 'Alkaline water for digestion',    'Had acidity issues for years. Switched to Prime 2 months ago — significant improvement. pH stays around 8.7 consistently.', TRUE, now() - INTERVAL '14 days'),
    (prime_id, 'Ritu Aggarwal',     'Gurugram',   5, 'Flagship features, fair price',   'Compared with brands selling at ₹18,000+. Knite Prime gives same features at half the price. Build quality is identical.', TRUE, now() - INTERVAL '21 days'),
    (prime_id, 'Manish Kapoor',     'Noida',      5, '14L tank is brilliant for parties', 'Hosted 20 people last weekend — never ran out of purified water. 100 GPD flow rate is real, not marketing.', TRUE, now() - INTERVAL '29 days'),
    (prime_id, 'Anita Rao',         'Visakhapatnam',5, 'TDS controller is smart',       'The TDS controller maintains essential minerals. Water doesn''t taste flat like other ROs. Genuinely tastes alive.', TRUE, now() - INTERVAL '41 days'),
    (prime_id, 'Harsh Vardhan',     'Jodhpur',    4, 'Premium feel, premium service',   'Beautiful design, fits well in modern kitchen. Service tech was excellent. -1 star only because the booklet could be more detailed.', TRUE, now() - INTERVAL '55 days'),
    (prime_id, 'Ishaan Bose',       'Kolkata',    5, 'Best gift to my parents',         'Bought this for my parents. They love the copper water for their morning routine. Free installation made it so easy.', TRUE, now() - INTERVAL '68 days'),
    (prime_id, 'Sunita Reddy',      'Hyderabad',  5, 'Worth upgrading from Shield',     'Upgraded from a Knite Shield to Prime — the difference in mouthfeel of water is noticeable. Alkaline + copper combo is excellent.', TRUE, now() - INTERVAL '82 days'),
    (prime_id, 'Aakash Mehrotra',   'Lucknow',    5, 'No bottled water for 3 months',   'Have not bought a single water bottle in 3 months. Saving roughly ₹2,000/month. Pays for itself in 5 months.', TRUE, now() - INTERVAL '100 days');

  END IF;
END $$;
