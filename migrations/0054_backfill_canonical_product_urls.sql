-- Site now synchronizes absolute public product URLs. Repair only historical
-- conversations that still have no URL or the old relative URL form.
UPDATE conversations AS conversation
SET product_href = (
  SELECT catalog.href
  FROM product_catalog AS catalog
  WHERE catalog.site_id = conversation.site_id
    AND catalog.id = conversation.product_id
)
WHERE (conversation.product_href IS NULL OR (
  conversation.product_href NOT LIKE 'https://%'
  AND conversation.product_href NOT LIKE 'http://%'
))
  AND EXISTS (
    SELECT 1
    FROM product_catalog AS catalog
    WHERE catalog.site_id = conversation.site_id
      AND catalog.id = conversation.product_id
      AND catalog.href IS NOT NULL
      AND (catalog.href LIKE 'https://%' OR catalog.href LIKE 'http://%')
  );
