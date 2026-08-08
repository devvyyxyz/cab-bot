-- 002_last_caught_and_views.sql
-- Add last_caught_at to users, create useful read-only views, and a trigger.

ALTER TABLE users ADD COLUMN last_caught_at INTEGER;

-- Update existing rows with NULL is fine; trigger will populate on future catches.

CREATE VIEW IF NOT EXISTS user_inventory_counts AS
  SELECT guild_id, user_id, COUNT(*) AS count
  FROM user_inventory
  GROUP BY guild_id, user_id;

CREATE VIEW IF NOT EXISTS top_catchers AS
  SELECT guild_id, user_id, COUNT(*) AS catches
  FROM catch_log
  GROUP BY guild_id, user_id
  ORDER BY catches DESC;

-- Trigger to keep users.last_caught_at up-to-date when catches are logged
CREATE TRIGGER IF NOT EXISTS trg_update_last_caught
AFTER INSERT ON catch_log
BEGIN
  UPDATE users SET last_caught_at = NEW.caught_at WHERE guild_id = NEW.guild_id AND user_id = NEW.user_id;
END;
