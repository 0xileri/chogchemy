# Artist references

Add your partner's approved PNG, JPEG, or WebP reference drawings here, then list the filenames in `art-direction.json` under `references`. Up to four references, at most 12 MB each. Update the label, description, rules, and version to match the intended style.

The server hashes the rules and image bytes at startup. Each new invitation binds that hash into both holders' signed permission. Changing any of these files requires new invitations and approvals; old signatures cannot authorize a new style.

These references are sent with the two parent images to OpenAI when generation starts. Add only artwork your collaborator has agreed to use for this purpose. No references are included by default.
