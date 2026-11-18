# Backup and restore verification

## What is automated

Before migrations, deployment creates a PostgreSQL 16 custom-format dump on the
Droplet in `/root/pr-system-backups`. The new archive is written to a temporary
file first. A failed/empty dump or unreadable archive stops deployment. Only after
success is the final `.dump` name published with a SHA-256 sidecar. Newly created
files are private to the running account. Retention (14 days) runs **after** the
new backup succeeds, not before. `pg_restore --list` checks the archive directory,
not every data block: it is **not evidence of a successful restore**.

The separate **Backup restore verification** Actions workflow tests a synthetic
fixture using fresh PostgreSQL 16 containers, and checks that invalid and truncated
archives fail. It has no production secrets and does not download production data.

## Operator restore drill (does not replace production)

Run only on an approved, trusted Docker host with enough RAM for the whole DB
(tmpfs), where the backup already resides. Do not upload business data to CI.
Use only trusted backups: PostgreSQL restore can execute SQL from an archive.

1. Verify the checksum from the backup directory: `sha256sum -c FILE.dump.sha256`.
   Keep a trusted checksum separately if tamper detection is required.
2. Run `bash scripts/backup/verify-restore.sh /absolute/path/FILE.dump`.
3. Record archive filename/hash, creation date, elapsed time, exit status and
   operator in the internal recovery log. No business rows or credentials in logs.

The script creates its own disposable container, with no host ports, no network,
no host mounts and no persistent volume. PostgreSQL data is in tmpfs. It restores
with `--exit-on-error --no-owner --no-acl`, checks every application table is readable
and rejects an empty database, then removes only the container it created. It has
no target database URL option and cannot be directed at production. Authentication
trust is confined to this no-network throwaway container, never a production DB.
An abrupt host shutdown/SIGKILL can skip cleanup: inspect and remove only the
identified drill container, never broad container/volume cleanup commands.

This proves the archive can be restored and read, **not** that application permissions,
attachments, login, PR/PO totals, relations or every business rule are correct.
A separate authorized UAT recovery must verify those with the matching application
revision, safe credentials and disabled outbound email/integrations before signoff.
Do not run production seed/reset scripts or `db push --accept-data-loss` to restore.

## Still required before declaring disaster recovery ready

- Scheduled backups independent of deployment; choose frequency/RPO and alert owner.
- Back up the attachment storage volume alongside the DB using a coordinated
  application-write pause or other consistent snapshot procedure. Database dumps
  alone do not include uploaded attachments.
- Approve an encrypted off-server destination, credentials, retention, access and
  deletion policy. Same-server backups do not protect against loss of the Droplet.
- Measure a real trusted-backup drill on the approved host; agree RTO and inspect
  representative documents/attachments in isolated UAT.
- Prepare an explicitly approved production recovery change: maintenance window,
  current-state safety backup, matching app revision, role/ACL restoration,
  file restore, validation, rollback plan and signoff. This PR does not automate
  production replacement, modify live scheduling, or configure any offsite upload.

No production restore, recurring backup schedule or off-server copy has been
performed by adding these scripts. Synthetic CI success must not be described as
successful recovery of the live system.
