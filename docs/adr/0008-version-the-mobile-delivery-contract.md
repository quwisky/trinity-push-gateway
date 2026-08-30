# Version the mobile delivery contract

FCM data messages will use a versioned, string-only schema containing the notification kind, opaque Account Route, event and room identifiers when applicable, and unread counts. Event deliveries expire after one hour without collapsing; count updates are silent, expire after one hour, and collapse per Account Route. iOS has a localized generic fallback, Android remains data-only, and neither platform receives arbitrary Matrix content, pusher data, or presentation values.
