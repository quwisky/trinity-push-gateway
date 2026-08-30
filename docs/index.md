---
layout: home

hero:
  name: Trinity Push Gateway
  text: Private Matrix notifications through Firebase
  tagline: A small, single-tenant gateway for Cloudflare Workers or self-hosted Bun.
  actions:
    - theme: brand
      text: Deploy on Cloudflare
      link: /deployment/cloudflare/
    - theme: alt
      text: Self-host with Docker
      link: /deployment/self-hosting/

features:
  - title: Matrix-compatible
    details: Accepts the standard Matrix push notification contract without requiring a custom homeserver integration.
  - title: Privacy-preserving
    details: Sends private data-only FCM messages and deliberately excludes Matrix content and identifiers from logs.
  - title: Two supported runtimes
    details: Run on the Cloudflare free-plan envelope with D1, or as one Bun container with durable SQLite storage.
---

The gateway translates Matrix push notifications into Firebase Cloud Messaging
requests for Trinity Android and iOS applications. It does not contain mobile
client code or a hosted multi-tenant service.

[Choose a deployment path](/getting-started/) or review the
[Matrix integration contract](/integration/matrix).
