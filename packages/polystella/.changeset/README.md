# Changesets

This directory tracks pending version + changelog entries between
releases. Each PR that user-visibly changes the package adds one
markdown file here describing the change.

## Adding a changeset

```bash
pnpm changeset
```

…which interactively asks:

- **Which packages are affected?** Just `polystella` for most
  changes. The `polystella-docs` site is ignored (`ignore` list in
  `config.json`).
- **Is the change major / minor / patch?** Pre-1.0, "major" stays
  reserved for 1.0; bump minor for breaking changes within 0.x,
  patch otherwise.
- **A summary.** One-liner that lands in `CHANGELOG.md`.

The result is a small markdown file in this directory. Commit it
with the PR.

## What happens at release time

The `Release` workflow in `.github/workflows/release.yml` opens a
"Version Packages" PR when there are pending changesets on `main`.
That PR:

- Bumps `package.json`'s version per the changeset severities.
- Updates `CHANGELOG.md` with each changeset's summary.
- Deletes the consumed changeset files.

Merging the "Version Packages" PR triggers a second run of the
workflow that creates the git tag (currently `changeset tag`; npm
publish wired separately when v1 is ready).
