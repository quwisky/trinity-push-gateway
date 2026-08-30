# Prefer delivery over exactly-once claims

FCM delivery and Cloudflare state cannot be committed atomically, so a crash can leave the gateway uncertain whether FCM accepted a message. The gateway will prefer a rare duplicate over silent notification loss, use a reclaimable pending lease to serialize concurrent attempts, retain terminal event outcomes for 24 hours, and describe its guarantee as effectively at-least-once rather than claiming exactly-once delivery. A mixed-result request remains retryable until every installation has a terminal outcome; completed outcomes are not sent again.
