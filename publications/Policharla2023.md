---
title: "Post-Quantum Privacy Pass via Post-Quantum Anonymous Credentials"
year: 2023
authors:
  - Guru-Vamsi Policharla
  - bas-westerbaan
  - armando-faz
  - christopher-wood
url: https://eprint.iacr.org/2023/414
related_interests:
  - cryptography
  - protocols
---

It is known that one can generically construct a post-quantum anonymous credential scheme, supporting the showing of arbitrary predicates on its attributes using general-purpose zero-knowledge proofs secure against quantum adversaries [Fischlin, CRYPTO 2006].
Traditionally, such a generic instantiation is thought to come with impractical sizes and performance. We show that with careful choices and optimizations, such a scheme can perform surprisingly well.
In fact, it performs competitively against state-of-the-art post-quantum blind signatures, for the simpler problem of post-quantum unlinkable tokens, required for a post-quantum version of Privacy Pass.

To wit, a post-quantum Privacy Pass constructed in this way using zkDilithium, our proposal for a STARK-friendly variation on Dilithium2, allows for a trade-off between token size (85–175KB) and generation time (0.3–5s) with a proof security level of 115 bits. Verification of these tokens can be done in 20–30ms. We argue that these tokens are reasonably practical, adding less than a second upload time over traditional tokens, supported by a measurement study.

Finally, we point out a clear advantage of our approach: the flexibility afforded by the general purpose zero-knowledge proofs. We demonstrate this by showing how we can construct a rate-limited variant of Privacy Pass that doesn't not rely on non-collusion for privacy.
