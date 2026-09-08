-- pg_stat_statements needs the library preloaded (see the postgres command in
-- the compose file); this creates the view side of it.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
