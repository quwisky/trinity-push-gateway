# Automate Cloudflare but not Firebase provisioning

Wrangler will manage the Worker, D1 binding and migrations, cleanup schedule, resource limits, and non-secret configuration. Firebase project and mobile-app registration, APNs credentials, and the least-privilege sending service account remain a documented operator procedure, with all secret values injected interactively and excluded from Git.
