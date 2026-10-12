-- Privileges for the application's database role (template).
--
-- NOT applied automatically: creating the role and switching the application's
-- connection string to it is part of each consumer's operations. Replace
-- :app_role (a psql variable, e.g. `psql -v app_role=my_app -f ...`) with the
-- application role. On Neon, create the role with SQL CREATE ROLE, not from
-- the console or API: roles created there are members of neon_superuser and
-- can disable the trigger.
--
-- The role must not own audit_log or audit_log_digest and must not hold
-- UPDATE, DELETE or TRUNCATE on them. Run as the table owner, after
-- audit_log_append_only.sql. The role also gets EXECUTE on
-- audit_log_create_month_partition() (SECURITY DEFINER) so it can create next
-- month's partition without owning the table.

REVOKE ALL ON audit_log, audit_log_digest FROM :"app_role";
GRANT SELECT, INSERT ON audit_log, audit_log_digest TO :"app_role";
GRANT EXECUTE ON FUNCTION audit_log_create_month_partition(timestamptz) TO :"app_role";
