---
title: "Rhizomes and the Roots of Efficiency — Improving Prio"
year: 2025
location: International Conference on Cryptology and Information Security in Latin America (LATINCRYPT 2025). Lecture Notes in Computer Science, vol 16129, Springer, Cham, 2025.
authors:
  - armando-faz
url: https://eprint.iacr.org/2025/1727
doi: 10.1007/978-3-032-06754-8_16
related_interests:
  - cryptography
  - privacy
---

Prio, tailored under privacy-by-design principles, is a protocol for aggregating client-provided measurements between non-colluding entities. The validity of measurements is determined by using a fully linear probabilistically-checkable proof (FLPCP). The Prover distributes secret shares of the measurement and the proof to multiple Verifiers. These Verifiers can only use linear queries on the input statement for validation without accessing the actual measurement. Efficiency is key for the practical application of Prio. The FLPCP operates with polynomials represented in the Lagrange basis using roots of unity as the nodes. However, we observe opportunities to improve its performance by embracing the Lagrange basis more extensively. For instance, we show an inversion-free O(n) time-complexity algorithm for polynomial evaluation in the Lagrange basis (an alternative to the classic rational barycentric formula). By applying our methods to libprio-rs, a cutting-edge Rust implementation, the Sharding phase (proof generation) runs a 36% faster and the Prep-Init phase (proof verification) is twice as fast, showing a substantial acceleration of the most time-consuming phases of Prio.
