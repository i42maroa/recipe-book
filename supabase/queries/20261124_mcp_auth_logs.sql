-- Run in Supabase Explorer > Run SQL, with query source set to Logs.
-- Choose the last 15 minutes in the query source menu and retry the connection.
-- This is ClickHouse SQL for logs, not PostgreSQL SQL for the database.
-- Read-only. Projects' private logs cannot be queried without dashboard access.
-- Inspect the rows for /oauth/token, including nearby errors without a path.
-- Redact any credentials if an upstream error unexpectedly includes them.
select
  timestamp,
  event_message,
  log_attributes['path'] as path,
  log_attributes['status'] as status,
  log_attributes['msg'] as message,
  log_attributes['error'] as error,
  log_attributes['request_id'] as request_id
from logs
where source = 'auth_logs'
order by timestamp desc
limit 50;
