# Use FCM for both mobile platforms

The gateway will send through FCM HTTP v1 for both Android and iOS instead of adding a separate direct APNs integration. Trinity's iOS client must therefore register an FCM token rather than its current raw APNs token and add Firebase Messaging plus a Notification Service Extension; Android must add Trinity-controlled private notification rendering. This client migration is accepted to keep the gateway single-provider and aligned with its original purpose, but will be implemented in a separate task and repository.
