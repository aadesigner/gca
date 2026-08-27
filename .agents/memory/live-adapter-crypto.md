---
name: Live provider credential encryption key
description: AES-256-GCM encryption for live provider credentials; consequences of SESSION_SECRET rotation.
---

# Live Provider Credential Encryption

## Rule
Live provider credentials (apiUrl + apiToken) are encrypted with AES-256-GCM. The key is derived as `sha256(SESSION_SECRET)`.

**Why:** No extra env var needed at implementation time; SESSION_SECRET already existed.

**How to apply:**
- Rotating SESSION_SECRET silently invalidates all stored live provider credentials. Admin must re-enter them via the Live Feeds config panel.
- A dedicated LIVE_PROVIDER_ENCRYPTION_KEY env var would decouple credential encryption from session key rotation (proposed as a follow-up).
- Decrypt failures return `{}` (stub mode), not an error, so misconfiguration degrades gracefully.
