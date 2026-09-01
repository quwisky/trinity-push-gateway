# Trinity Push Gateway

The Trinity Push Gateway context covers the handoff of Matrix notification requests to compatible mobile client installations through a mobile push provider.

## Language

**Push Gateway**:
The single-tenant service that accepts Matrix notification requests and attempts delivery to client installations belonging to one compatible app operator.
_Avoid_: Push server, notification server, Sygnal

**Gateway Operator**:
The person or organization that controls a Push Gateway deployment, its app identifiers, and its Firebase project.
_Avoid_: Host, administrator, Trinity

**Push Gateway UI**:
The optional interface through which Gateway Operators observe and operate a self-hosted Push Gateway.
_Avoid_: Trinity client, admin console

**Operator Identity**:
The identity by which a Gateway Operator is recognized when using a Push Gateway UI.
_Avoid_: Administrator, UI user

**Operator Session**:
A bounded period during which a Push Gateway UI recognizes an Operator Identity as able to act.
One canonical response contract owns every runtime, published, and client
projection of an Operator Session.
_Avoid_: Login, UI session

**Operator Action**:
An operation requested by an Operator Identity through a Push Gateway UI.
_Avoid_: Administrator action, UI command

**Operator Audit Entry**:
The historical record of an Operator Action or security-relevant gateway occurrence, its outcome, and the Operator Identity responsible when one exists.
_Avoid_: Activity log, audit event

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
One installed instance of a compatible Android or iOS app, identified to the mobile push provider by a Push Key.
_Avoid_: Device, user, client

**Account Route**:
An opaque identifier created by a Client Installation to associate a Delivery Message with one locally signed-in Matrix account without exposing that account's Matrix user ID.
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
A registration held by a Homeserver that associates a Matrix account, compatible app, Push Gateway, Push Key, and Account Route for notification delivery.
_Avoid_: Device registration, push subscription
