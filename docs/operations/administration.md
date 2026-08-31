# Administration operations and recovery

The UI shows privacy-bounded operational data and fixed actions; it is not a
general shell, database browser, identity manager, or configuration editor.
Every mutation requires the exact public origin, a session-bound XSRF token,
an audit intent that commits before execution, and a per-action lease, deadline,
and cooldown.

## Sessions and access

Operator Sessions are local opaque records keyed by the OIDC issuer and subject.
They have a 30-minute idle limit and an eight-hour absolute limit by default,
with at most five sessions per identity and 100 per deployment. Provider access
does not extend these limits. Removing a user from the required group prevents
new sessions; revoke existing sessions from the Security page or purge all of
them from a stopped one-off container:

```sh
docker compose \
  --env-file .env.self-host \
  --env-file .env.self-host-admin \
  --file compose.yml \
  --file compose.admin.yml \
  run --rm --no-deps gateway session-purge
```

The command refuses disabled or invalid administration configuration. It does
not contact the provider and does not create a recovery identity.

## Operator actions

The Operations page exposes only:

- **Validate Firebase:** performs an FCM `validate_only` request using a
  synthetic target. It proves credential, project, and API access, not that a
  mobile installation exists or will display a notification.
- **Clean delivery state:** applies the normal bounded retention cleanup to
  delivery records and budgets.
- **Create gateway backup:** writes and integrity-checks a new
  `gateway.sqlite` snapshot below `/data/backups`.

Never retry an `outcome_unknown` action automatically: execution may have
completed even though its final audit record failed. Review the audit page,
backup directory, health, and redacted logs first. A busy or cooldown response
should be allowed to expire rather than bypassed.

## Metrics and audit privacy

Metrics use only hourly/daily fixed-cardinality request, platform, outcome, and
latency buckets. Metrics-writer startup, lock, corruption, or worker death drops
new aggregates and never changes a Matrix response. Audit records contain the
operator issuer/subject, action kind, coarse outcome, and bounded reason; they
do not contain provider tokens, client secrets, Matrix identifiers, Push Keys,
account routes, or notification content.

The defaults retain metrics for 30 days and audit entries for 90 days. Cleanup
is bounded per pass. Treat `admin.sqlite`, browser sessions, audit data, and
backups as sensitive operational metadata even though message content is never
stored.

The Security page queries a UTC half-open range of at most 90 days. Its opaque
load-older cursor fixes the initial range, filters, page size, timestamp, and
identifier boundary; it is signed with the administration session secret and
expires 15 minutes after the first page. Replaying it with the same filters is
safe and deterministic. Changing any filter starts a new query; editing,
reusing after expiry, or replaying the cursor with different filters is rejected.

## Recover from an identity-provider outage

Existing unexpired local sessions remain governed by local policy, while new
login and provider logout may fail. Matrix delivery and public health must stay
available. Restore the provider at the exact configured issuer; do not change
the issuer temporarily because `(issuer, subject)` is the Operator Identity key.

If access must be revoked while the provider is unavailable:

1. keep port 3000 private behind the TLS proxy;
2. disable the administration override or block `/admin/` at the proxy;
3. run `session-purge` with the valid administration configuration;
4. repair provider discovery, client credentials, callback URLs, and group
   mapping;
5. recreate the service and test member/non-member login before reopening the
   route.

## Recover from administration storage failure

An `admin.sqlite` failure must not be repaired by pointing administration at
`gateway.sqlite`; identical, symlinked, or hardlinked database files are
rejected. Keep delivery running with administration disabled, restore the full
volume or a separately protected administration database, then run the current
image's `migrate` command before re-enabling. If the administration history is
intentionally discarded, archive the failed files offline and allow the current
image to create a fresh `admin.sqlite`; all previous sessions, audits, metrics,
operation leases, and UI backup metadata are lost.

## Routine checks

- Require public `/health` and an authenticated Overview to be ready.
- Alert separately on Matrix failures and `/admin/*` failures.
- Monitor `/data` capacity, both SQLite database families, and `/data/backups`.
- Review sessions and audit outcomes after group, client, or secret changes.
- Periodically prove a full-volume restore and the immediately preceding image's
  one-version rollback path.
- Keep provider, reverse proxy, and gateway clocks synchronized.

See [troubleshooting](/operations/troubleshooting) for symptom-based checks.
