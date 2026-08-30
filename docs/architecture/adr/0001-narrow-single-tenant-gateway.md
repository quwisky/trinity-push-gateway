# Keep the gateway narrow and single-tenant

The service will implement the Matrix Push Gateway boundary for Trinity's known Android and iOS app identifiers using one operator-controlled Firebase project. It will not own client registration, user accounts, Matrix event retrieval, an administration UI, or third-party Firebase credentials, because those capabilities would enlarge the security and operational surface without serving Trinity notification delivery.
