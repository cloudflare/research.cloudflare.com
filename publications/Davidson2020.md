---
title: Adaptively secure constrained pseudorandom functions in the standard model
year: 2020
location: Advances in Cryptology - CRYPTO 2020 - 40th Annual International Cryptology Conference, vol 12170, pp. 559-589. Springer, Cham, 2020.
authors:
  - Alex Davidson
  - Shuichi Katsumata
  - Ryo Nishimaki
  - Shota Yamada
  - Takashi Yamakawa
url: https://eprint.iacr.org/2020/111.pdf
doi: 10.1007/978-3-030-56784-2_19
related_areas:
  - cryptography
---

Constrained pseudorandom functions (CPRFs) allow learning “constrained” PRF keys that can evaluate the PRF on a subset of the input space, or based on some predicate. First introduced by Boneh and Waters [AC’13], Kiayias et al. [CCS’13] and Boyle et al. [PKC’14], they have shown to be a useful cryptographic primitive with many applications. These applications often require CPRFs to be adaptively secure, which allows the adversary to learn PRF values and constrained keys in an arbitrary order. However, there is no known construction of adaptively secure CPRFs based on a standard assumption in the standard model for any non-trivial class of predicates. Moreover, even if we rely on strong tools such as indistinguishability obfuscation (IO), the state-of-the-art construction of adaptively secure CPRFs in the standard model only supports the limited class of NC1 predicates.
In this work, we develop new adaptively secure CPRFs for various predicates from different types of assumptions in the standard model. Our results are summarized below.
• We construct adaptively secure and O(1)-collusion-resistant CPRFs for t-conjunctive normal form (t-CNF) predicates from one-way functions (OWFs) where t is a constant. Here, O(1)-collusion-resistance means that we can allow the adversary to obtain a constant number of constrained keys. Note that t-CNF includes bit-fixing predicates as a special case.
• We construct adaptively secure and single-key CPRFs for inner-product predicates from the learning with errors (LWE) assumption. Here, single-key security means that we only allow the adversary to learn one constrained key. Note that inner-product predicates include t-CNF predicates for a constant t as a special case. Thus, this construction supports more expressive class of predicates than that supported by the first construction though it loses the collusion-resistance and relies on a stronger assumption.
• We construct adaptively secure and O(1)-collusion-resistant CPRFs for all circuits from the LWE assumption and indistinguishability obfuscation (IO). The first and second constructions are the first CPRFs for any non-trivial predicates to achieve adaptive security outside of the random oracle model or relying on strong cryptographic assumptions. Moreover, the first construction is also the first to achieve any notion of collusion-resistance in this setting. Besides, we prove that the first and second constructions satisfy weak 1-key privacy, which roughly means that a constrained key does not reveal the corresponding constraint. The third construction is an improvement over previous adaptively secure CPRFs for less expressive predicates based on IO in the standard model.
