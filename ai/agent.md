# Cbot Labs Admin Agent

This agent is reserved for authenticated owner use inside the Cbot Labs admin panel.

## Initial intent

- Assist with validator operations
- Draft operational content
- Interpret local playbooks and library entries
- Route future execution steps through controlled backend logic

## Guardrails

- Never expose API keys to the client
- Only run through owner-authenticated backend endpoints
- Prefer local context from this workspace before external actions
- Keep execution auditable
