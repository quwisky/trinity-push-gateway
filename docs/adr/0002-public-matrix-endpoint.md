# Accept notification requests from arbitrary homeservers

The Matrix notification endpoint will be publicly reachable so Trinity installations can receive notifications when registered with arbitrary Matrix homeservers. Since standard notification requests do not authenticate a homeserver to the gateway, the boundary will instead be protected through exact routing, known app identifiers, bounded validation, rate controls, and careful resource limits.
