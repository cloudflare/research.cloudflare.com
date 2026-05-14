# PolyStella docs — runnable examples

This directory will hold minimal Astro projects paired with the
cookbook recipes in `docs/src/content/docs/cookbook/`.

## Status

Empty for v0.x. The cookbook pages are written but don't yet have
companion projects.

## Adding an example

When you add a cookbook recipe, drop a runnable Astro project here
under a slug matching the recipe filename:

```
docs/examples/monorepo/         # paired with cookbook/monorepo.md
docs/examples/custom-loader/    # paired with cookbook/custom-loader.md (planned)
```

Each example project must:

- Have its own `package.json` declaring `polystella` as a workspace
  dependency (`"polystella": "workspace:*"`).
- Be buildable in isolation via `pnpm --filter polystella-example-<slug> build`.
- Include a `README.md` pointing back to the cookbook recipe it
  illustrates.

`docs/scripts/check-examples.ts` walks this directory and runs
`astro check` against each example. The CI build's `docs:build`
step depends on this passing.
