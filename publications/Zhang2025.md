---
title: "Rethinking Web Cache Design for the AI Era"
year: 2025
location: "ACM Symposium on Cloud Computing 2025"
authors:
  - Yazhou Zhang
  - Jinqing Cai
  - avani-wildani
  - Ana Klimovic
url: https://yazhuozhang.com/assets/publication/socc25-rethinking-web-cache.pdf
related_interests:
  - ai
  - storage
---

Web caches have long been effective at reducing latency and back-
end load by storing popular content close to users, exploiting the
temporal and spatial locality of human-driven access patterns. How-
ever, the rise of AI-generated traffic is challenging this assumption.
AI agents such as search crawlers and data scrapers issue large vol-
umes of diverse, low-referrer requests with minimal reuse, which
degrade cache effectiveness, interfere with human-relevant content,
and increase pressure on backend systems. In this paper, we argue
that caching infrastructure must evolve to address this shift. We
analyze emerging AI traffic patterns and study their impact on
caching performance using a CDN prototype based on Wikime-
dia’s architecture. Our results show that even modest amounts of
AI traffic lead to significant cache inefficiency. We propose a new
cache design paradigm in which caches act as lightweight filters to
preserve locality for human traffic and apply differentiated policies
or tiers to handle AI traffic more efficiently.
