# Defer the version-one client rollout

This repository and task deliver only the gateway. Companion mobile changes will be implemented in a separate Trinity client task: updated clients must register a version-one Pusher containing an opaque Account Route, use FCM tokens on both platforms, and implement private delivery handling. The gateway and D1 migration can deploy first; legacy pushers without the version-one routing contract are rejected and will be replaced only after the separate client rollout.
