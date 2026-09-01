# Push Gateway UI remote state

Overview and Metrics use one deep remote-state module for the complete
read lifecycle. A page supplies only a generated-client request and, for
Metrics, the existing predicate that says whether its selected UTC range is
current enough to poll.

The module owns:

- the initial visible load and the idle, loading, fresh, stale, and error states;
- retention of the last successful observation when a refresh fails;
- explicit retry through the same refresh path;
- immediate refresh when a hidden document becomes visible;
- 30-second polling only while visible; and
- one shared in-flight request across automatic polling and explicit refresh,
  with one latest-range refresh queued when Metrics parameters change.

The generated Overview and Metrics clients therefore remain transport
adapters. They return one typed observable per request and neither retain data
nor decide when a request occurs. Pages consume only the module's `state`,
`data`, and `refresh` interface.

## Proof and migration decision

The proof removed page-owned `DestroyRef` subscriptions, visibility-event and
timer composition, duplicated fresh-or-stale extraction, and the race between
polling and Retry. Focused interface tests exercise first-load failure, stale
retention, retry, hidden-to-visible refresh, visibility-paused polling, Metrics'
current-range predicate, same-query overlap suppression, and latest-range
queueing behind an older request. The existing browser suite continues to
exercise Overview loading, stale recovery and Retry, plus populated, filtered,
and empty Metrics views.

This is enough leverage for the two continuously observed read capabilities,
but not evidence for a broad migration yet. Configuration is a one-time read;
Operations coordinates reads with Operator Actions; Security owns session
revocation and append-only audit pagination. Extending the interface for those
unshared behaviors would be hypothetical. Their existing manual resources stay
in place until a separately scoped change can demonstrate a shared production
need without widening this interface.
