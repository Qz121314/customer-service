PRAGMA foreign_keys = ON;

-- Modern routing is fully represented by product_catalog + agent_routing_scopes.
-- 0015 already copied historical agent_products rows into explicit product
-- scopes, so these rollout-only tables no longer own live routing data.
DROP TABLE IF EXISTS group_routing_rules;
DROP TABLE IF EXISTS group_agents;
DROP TABLE IF EXISTS routing_catalog_categories;
DROP TABLE IF EXISTS routing_catalog_sections;
DROP TABLE IF EXISTS agent_products;
DROP TABLE IF EXISTS support_groups;
