# Use a stable production hostname

Production will expose the gateway through a stable custom hostname on a Cloudflare-managed domain because a hostname change requires clients to replace their complete Pusher URL. The free `workers.dev` address is reserved for development, and the exact production hostname remains deployment configuration until the operator supplies it.
