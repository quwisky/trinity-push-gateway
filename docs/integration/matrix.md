# Trinity Client Contract Handoff

This document is a contract for a separate Trinity client task. No client implementation belongs in this repository.

## Pusher registration

Each client installation registers its FCM token as the Matrix Push Key and uses its platform app ID:

- Android: `ovh.qwky.trinity.android`
- iOS: `ovh.qwky.trinity.ios`

Pusher data must contain:

```json
{
  "format": "event_id_only",
  "trinity_account_id": "opaque-stable-route",
  "trinity_push_version": "1"
}
```

The Account Route is opaque to the gateway, stable for the local Matrix account, unique enough to select that account on the installation, and 1–48 base64url characters (`A-Z`, `a-z`, `0-9`, `_`, or `-`). It must not be a Matrix user ID, access token, device secret, or other direct identifier.

## FCM data payload

Every data value is a string. Common keys are:

- `schema`: always `"1"`
- `kind`: `"event"` or `"counts"`
- `trinity_account_id`: the opaque account route
- `unread` and `missed_calls`: non-negative decimal integers
- `sound`: `"true"` or `"false"`
- `highlight`: optional `"true"` or `"false"`

Event deliveries additionally include `event_id` and `room_id`. Clients must sync and decrypt Matrix content themselves; the gateway never supplies plaintext notification content.

## Platform expectations

Android receives data-only messages. The client selects the account, syncs/decrypts the event, and renders the local notification.

iOS event delivery includes a generic localized fallback using `TRINITY_NOTIFICATION_TITLE` and `TRINITY_NEW_MESSAGE`. The separate client task may use a Notification Service Extension to replace that fallback after sync/decryption. Count-only updates are silent and collapsible on both platforms.

## Rollout checklist for the separate task

1. Register FCM tokens using the version-one pusher data above.
2. Replace any legacy pusher that the gateway returns in `rejected`.
3. Add multi-account routing tests using the opaque Account Route.
4. Verify event sync/decryption, generic locked-state behavior, notification tapping, sound, badge counts, count collapse, and token rotation on real Android and iOS devices.
5. Confirm no client log or analytics event records the FCM token or private Matrix payload.
