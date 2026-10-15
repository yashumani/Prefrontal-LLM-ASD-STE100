SELECT SUM(gross_cents - discount_cents - return_cents) AS value_cents
FROM orders
WHERE status = 'completed';
