-- 003_indexes_and_summaries.sql
-- Add performance indexes and a materialized summary table for user inventory counts.

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_user_inventory_guild_user ON user_inventory (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_inventory_rot ON user_inventory (rot_name);
CREATE INDEX IF NOT EXISTS idx_catch_log_guild_user ON catch_log (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_catch_log_rot ON catch_log (rot_name);

-- Materialized counts table to avoid expensive COUNT(*) queries on large user_inventory
CREATE TABLE IF NOT EXISTS user_inventory_count (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

-- Keep counts in sync on insert
CREATE TRIGGER IF NOT EXISTS trg_user_inventory_count_insert
AFTER INSERT ON user_inventory
BEGIN
  INSERT INTO user_inventory_count (guild_id, user_id, count)
    VALUES (NEW.guild_id, NEW.user_id, 1)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET count = user_inventory_count.count + 1;
END;

-- Keep counts in sync on delete
CREATE TRIGGER IF NOT EXISTS trg_user_inventory_count_delete
AFTER DELETE ON user_inventory
BEGIN
  UPDATE user_inventory_count SET count = count - 1 WHERE guild_id = OLD.guild_id AND user_id = OLD.user_id;
  DELETE FROM user_inventory_count WHERE guild_id = OLD.guild_id AND user_id = OLD.user_id AND count <= 0;
END;

-- Ensure transactions updating both tables remain quick
ANALYZE;
