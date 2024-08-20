---
title: "X-Wing: The Hybrid KEM You've Been Looking For"
year: 2024
location: "IACR Communications in Cryptology (Volume: 1, Issue: 1, March 2024)."
authors:
  - Manuel Barbosa
  - Deirdre Connolly
  - João Diogo Duarte
  - Aaron Kaiser
  - Peter Schwabe
  - Karolin Varner
  - bas-westerbaan
doi: 10.62056/a3qj89n4e
related_interests:
  - cryptography
  - protocols
---

X-Wing is a hybrid key-encapsulation mechanism based on X25519 and ML-KEM-768. It is designed to be the sensible choice for most applications. The concrete choice of X25519 and ML-KEM-768 allows X-Wing to achieve improved efficiency compared to using a generic KEM combiner. In this paper, we introduce the X-Wing hybrid KEM construction and provide a proof of security. We show (1) that X-Wing is a classically IND-CCA secure KEM if the strong Diffie-Hellman assumption holds in the X25519 nominal group, and (2) that X-Wing is a post-quantum IND-CCA secure KEM if ML-KEM-768 is itself an IND-CCA secure KEM and SHA3-256 is secure when used as a pseudorandom function. The first result is proved in the ROM, whereas the second one holds in the standard model. Loosely speaking, this means X-Wing is secure if either X25519 or ML-KEM-768 is secure. We stress that these security guarantees and optimizations are only possible due to the concrete choices that were made, and it may not apply in the general case.
