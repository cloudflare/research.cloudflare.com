---
title: A document with a single oversize section
excerpt: Exercises the paragraph-by-paragraph fallback in packGroupsIntoBatches.
---

## Single Long Section

The first paragraph of the oversize section establishes the topic with enough text to consume a portion of the input-token budget on its own when the budget is set very low for testing purposes.

The second paragraph continues with more material, padding out the section so that the heading-anchored group exceeds whatever soft cap the operator configured for batching input tokens.

The third paragraph adds yet another block of content with the explicit goal of pushing the group well past the threshold at which the batcher would otherwise pack a single section into one batch.

The fourth paragraph keeps going, since a realistic oversize-section case in production would consist of several long paragraphs anchored to a single heading rather than one absurdly large block of prose.

The fifth paragraph rounds out the section with material designed to exercise the paragraph-by-paragraph fallback, where the heading anchor is retained for the first sub-batch but lost for the rest of the section.

The sixth paragraph wraps the test fixture and ensures the total token count for the section group comfortably exceeds the tight budget the smoke test will configure when exercising this fixture.
