# Trinity Push Gateway

The Trinity Push Gateway context covers the handoff of Matrix notification requests to Trinity mobile client installations through a mobile push provider.

## Language

**Push Gateway**:
The Trinity-operated service that accepts Matrix notification requests and attempts delivery to the addressed Trinity client installations.
_Avoid_: Push server, notification server, Sygnal

**Notification Request**:
A Matrix homeserver's request for one event notification or an update to unread counts, addressed to one or more client installations.
_Avoid_: Push, event, message

**Event Notification**:
A Notification Request concerning a particular Matrix event that may cause a Client Installation to alert its user.
_Avoid_: Event, message notification

**Count Update**:
A Notification Request that updates unread or missed-call counts without identifying a new Matrix event.
_Avoid_: Badge push, silent push

**Delivery Message**:
The privacy-preserving mobile notification derived from a Notification Request for one Client Installation.
_Avoid_: Firebase notification, translated notification

**Client Installation**:
One installed instance of a Trinity Android or iOS app, identified to the mobile push provider by a Push Key.
_Avoid_: Device, user, client

**Account Route**:
An opaque identifier created by a Trinity Client Installation to associate a Delivery Message with one locally signed-in Matrix account without exposing that account's Matrix user ID.
_Avoid_: User ID, account ID, `trinity_user_id`

**Push Key**:
The opaque mobile push-provider identifier for a Client Installation.
_Avoid_: Device ID, user ID

**Rejected Push Key**:
A Push Key that the mobile push provider has declared permanently invalid and that a Matrix homeserver must stop using.
_Avoid_: Failed token, bad device

**Transient Delivery Failure**:
An unsuccessful delivery attempt that does not establish that its Push Key is permanently invalid and may succeed when retried.
_Avoid_: Rejected push key, dropped notification

**Homeserver**:
A Matrix server that evaluates a user's push rules and sends a Notification Request to the Push Gateway.
_Avoid_: Client server, origin server

**Pusher**:
A registration held by a Homeserver that associates a Matrix account, Trinity app, Push Gateway, Push Key, and Account Route for notification delivery.
_Avoid_: Device registration, push subscription
