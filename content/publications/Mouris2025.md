---
title: "Mastic: Private Weighted Heavy-Hitters and Attribute-Based Metrics"
year: 2025
location: "32nd ACM Conference on Computer and Communications Security (CCS 2025), Salt Lake City, UT, USA, October 2025"
authors:
  - dimitris-mouris
  - christopher-patton
  - hannah-davis
  - pratik-soni
  - nektarios-georgios-tsoutsos
url: https://eprint.iacr.org/2024/221
related_interests:
  - cryptography
  - privacy
pillar: private
metaDescription: "Privacy-preserving protocol for computing weighted heavy-hitters and attribute-based metrics using Prio and Poplar, enabling aggregate statistics without revealing individual measurements."
---

Insight into user experience and behavior is critical to the success of large software systems and web services. Gaining such insights, while preserving user privacy, is a significant challenge. Recent advancements in multi-party computation have made it practical to securely compute aggregates over secret shared data. Two such protocols have emerged as candidates for standardization at the IETF: Prio (NSDI 2017) for general-purpose statistics; and Poplar (IEEE S&P 2021) for heavy hitters, where the goal is to compute the most popular inputs held by users without learning the inputs themselves. While each of these protocols is well-suited to certain applications, there remain a number of use cases identified by IETF for which neither Prio nor Poplar is practical.

We introduce Mastic, a protocol for the following functionality: each of a large number of clients holds an input (e.g., a URL) and its corresponding weight (e.g., page load time); for a given candidate input (or prefix), a small number of non-colluding servers wish to securely aggregate the weights of clients that hold that input (or some input with that prefix), without learning the weights or which client holds which input. This functionality makes two new classes of applications possible. The first is a natural generalization of heavy hitters we call weighted heavy-hitters. The second is an enhancement of Prio-style metrics we call attribute-based metrics in which aggregates are grouped by hierarchical user attributes (e.g., their geographic location or software version). We demonstrate Mastic's practicality for these applications with a real-world example of each. We also compare our protocol with Prio and Poplar on a wide area network. Overall, we report over one order of magnitude performance improvement over Poplar for plain heavy-hitters and improvement over Prio for attribute-based metrics.
