---
title: Configuration reference
description: Full polystella.config.mjs option reference, generated from the zod schema.
---

:::note[Auto-generated]
This page is regenerated from `src/config/options.ts` on every
`pnpm --filter polystella-docs build`. Don't hand-edit; the
generator overwrites it.
:::

The table below lists every option accepted by
`polystella(options)` and `polystella.config.mjs`. Defaults shown
are exactly what the schema applies when the field is omitted.

For prose context on individual options, see the
[overview page](/configuration/) and the adjacent concept pages.

| Path | Type | Default | Required | Description |
| --- | --- | --- | --- | --- |
| `sourceDir` | string | `"./content"` | Optional | Project-relative path to the content root the walker scans. |
| `include` | array of string | `["**/*.md","**/*.mdx"]` | Optional | Glob patterns (relative to `sourceDir`) for files the pipeline picks up. |
| `exclude` | array of string | `[]` | Optional | Glob patterns to skip even when they match `include`. |
| `markdown` | object | `{"keys":{},"urls":{},"contextKeys":{}}` | Optional | Markdown / MDX adapter configuration. |
| `markdown.keys` | record (string → array of string) | `{}` | Optional | Per-glob → frontmatter keys to translate. Body inline text is automatic. |
| `markdown.urls` | record (string → array of string) | `{}` | Optional | Per-glob → frontmatter URL keys that should be locale-prefixed at staging. |
| `markdown.contextKeys` | record (string → array of string) | `{}` | Optional | Per-glob → frontmatter keys whose source-language values feed the per-batch document-context block. Untranslated. NOT in the cache-key hash. |
| `toml` | object | `{"keys":{},"urls":{}}` | Optional | TOML adapter configuration. |
| `toml.keys` | record (string → array of string) | `{}` | Optional | Per-glob → dotted key-paths to translate. |
| `toml.urls` | record (string → array of string) | `{}` | Optional | Per-glob → dotted key-paths of URL fields that should be locale-prefixed. |
| `json` | object | `{"keys":{},"urls":{}}` | Optional | JSON adapter configuration. |
| `json.keys` | record (string → array of string) | `{}` | Optional | Per-glob → dotted key-paths to translate. |
| `json.urls` | record (string → array of string) | `{}` | Optional | Per-glob → dotted key-paths of URL fields that should be locale-prefixed. |
| `yaml` | object | `{"keys":{},"urls":{}}` | Optional | YAML adapter configuration. |
| `yaml.keys` | record (string → array of string) | `{}` | Optional | Per-glob → dotted key-paths to translate. |
| `yaml.urls` | record (string → array of string) | `{}` | Optional | Per-glob → dotted key-paths of URL fields that should be locale-prefixed. |
| `noPrefixUrls` | array of string | `[]` | Optional | Internal URL paths the link rewriter leaves unprefixed. Picomatch globs match against the path portion. |
| `routes` | array of string \| object | `[]` | Optional | Source pages to inject locale-prefixed shims for. Each entry is a `string` or `{ source, imports }`; `imports` are extra modules (typically CSS) threaded into the shim's frontmatter. |
| `routesImports` | array of string | `[]` | Optional | Imports threaded into every shim's frontmatter, in addition to per-route `imports`. Typically a single global stylesheet. |
| `noTranslateBehavior` | enum: `404` \| `fallback` | `"fallback"` | Optional | Per-entry `noTranslate: true` policy. `fallback` returns source content tagged as default-locale; `404` drops the entry. |
| `rewriteInternalLinks` | boolean | `true` | Optional | Whether to locale-prefix internal links during staging. Disable to leave links untouched (rare). |
| `r2` | object | — | Optional | Cloudflare R2 cache configuration. Omit to run without caching. |
| `r2.accountId` | string | — | Required | Cloudflare account ID owning the R2 bucket. |
| `r2.bucket` | string | — | Required | R2 bucket name where cached translations are stored. |
| `r2.prefix` | string | `"i18n/"` | Optional | Key prefix inside the bucket. Must end with `/`. Used to isolate branches via `previews/<branch>/i18n/`. |
| `r2.accessKeyId` | string | — | Required | R2 access key id (S3-compatible credential). |
| `r2.secretAccessKey` | string | — | Required | R2 secret access key (S3-compatible credential). |
| `r2.endpoint` | string | — | Optional | Override the default R2 endpoint (`https://<accountId>.r2.cloudflarestorage.com`). Useful for testing. |
| `r2.readOnly` | boolean | `false` | Optional | Skip PUTs and the post-translation prune; GETs still happen. Canonical use: preview builds that consume main's cache without writing back. |
| `r2.readFallbackPrefixes` | array of string | `[]` | Optional | Additional prefixes consulted on cache miss. First hit wins; bytes are NOT promoted into the primary prefix. Each entry must end with `/`. |
| `r2.keepLastN` | number \| `false` | `5` | Optional | Per (locale, sourcePath), keep only N most-recent hash variants. `false` disables pruning. |
| `r2.bulkListOnStart` | boolean | `true` | Optional | Pre-list every cache key per locale at the start of the live phase, turning per-pair cache checks into in-memory lookups. Disable for caches with 10k+ keys per locale where the list cost dominates. |
| `provider` | discriminated union (by `kind`) | — | Optional | AI translator provider. Omit for dry-run / parse-only workflows. |
| `provider (kind = "workers-ai").kind` | `"workers-ai"` | — | Required | Discriminator selecting the Workers AI provider. |
| `provider (kind = "workers-ai").accountId` | string | — | Required | Cloudflare account ID that owns the Workers AI usage. |
| `provider (kind = "workers-ai").apiToken` | string | — | Required | Workers AI API token with model-run scope. |
| `provider (kind = "workers-ai").endpoint` | string | — | Optional | Override the default Workers AI endpoint. Useful for AI Gateway proxies or testing. |
| `provider (kind = "workers-ai").model` | string \| object | — | Required | Single model id (e.g. `@cf/meta/llama-3.1-8b-instruct`) or per-locale map with a `default` key. Model id is part of the cache key. |
| `provider (kind = "workers-ai").maxTokens` | number | `8192` | Optional | Max output tokens per call. The Workers AI default (~256) truncates multi-segment translations; 8192 fits under llama-3.1-8b's cap. |
| `provider (kind = "workers-ai").batchInputTokenBudget` | number | `4000` | Optional | Soft cap on per-batch input tokens. The pipeline packs adapter-grouped segments into batches that fit under this budget. |
| `provider (kind = "anthropic").kind` | `"anthropic"` | — | Required | Discriminator selecting the Anthropic provider. |
| `provider (kind = "anthropic").apiKey` | string | — | Required | Anthropic API key. |
| `provider (kind = "anthropic").model` | string \| object | — | Required | Single model id (e.g. `claude-3-5-sonnet-latest`) or per-locale map with a `default` key. Model id is part of the cache key. |
| `provider (kind = "anthropic").maxTokens` | number | `8192` | Optional | Max output tokens per call. |
| `provider (kind = "anthropic").batchInputTokenBudget` | number | `4000` | Optional | Soft cap on per-batch input tokens. See the Workers AI provider's identical field for the rationale. |
| `glossary` | object | — | Optional | Per-locale glossary. Either `{ file: 'path/{locale}.yaml' }` or `{ inline: { locale: { ... } } }`. |
| `overridesDir` | string | `"./i18n/overrides"` | Optional | Project-relative directory where hand-translated overrides live. Drop files at `<overridesDir>/<locale>/<mirrored-source-path>`. |
| `prompt` | object | `{}` | Optional | Prompt-tuning hooks for the translator. |
| `prompt.context` | string | — | Optional | Site-/domain-specific guidance appended to the default 'You are a professional translator.' opener. |
| `debug` | object | `{}` | Optional | Debug-only knobs. None of these affect production builds. |
| `debug.previewDir` | string | — | Optional | When set, writes a copy of each translated file under `<previewDir>/<locale>/<source>` for human inspection. Ephemeral. |
| `fallback` | enum: `default-locale` \| `skip` | `"default-locale"` | Optional | Cross-locale miss policy for entries without `noTranslate`. `default-locale` returns source as fallback; `skip` 404s. |
| `concurrency` | number | `4` | Optional | Max parallel (file, locale) pair workers. |
| `maxRetries` | number | `2` | Optional | Retry attempts on transient translator failures. `0` disables retries; default 2 allows up to 3 attempts. |
| `dryRun` | boolean | `false` | Optional | Skip provider calls and R2 writes; just log planned work. Same effect as the CLI `--dry-run` flag. |
| `runOn` | array of enum: `build` \| `dev` | `["build"]` | Optional | Astro commands the translation pipeline runs under. Default `['build']` skips `astro dev`. |
| `mode` | enum: `auto` \| `standalone` \| `starlight` | `"auto"` | Optional | Integration mode. `auto` and `standalone` are equivalent today; `starlight` is planned but not yet supported. |
| `verbose` | boolean | `false` | Optional | Log one line per (file, locale) pair. Off by default; the closing summary and failures still log. |
| `middleware` | boolean | `true` | Optional | Auto-register the polystella request middleware. `false` disables auto-registration so you can compose manually via `sequence(...)`. |
