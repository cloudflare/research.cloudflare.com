---
title: "Hybrid Obfuscated Key Exchange and KEMs"
year: 2025
location: "CRYPTO 2025"
authors:
  - Felix Günther
  - Michael Rosenberg
  - Douglas Stebila
  - Shannon Veitch
doi: 10.1007/978-3-032-01881-6_18
related_interests:
  - cryptography
  - post-quantum
  - protocols
pillar: safe
metaDescription: "We build hybrid post-quantum key exchange mechanisms for protocols that need to look indistinguishable from randomness to all onlookers."
---

Hiding the metadata in Internet protocols serves to protect user privacy, dissuade traffic analysis, and prevent network ossification. Fully encrypted protocols require even the initial key exchange to be obfuscated: a passive observer should be unable to distinguish a protocol execution from an exchange of random bitstrings. Deployed obfuscated key exchanges such as Tor's pluggable transport protocol obfs4 are Diffie–Hellman-based, and rely on the Elligator encoding for obfuscation. Recently, Günther, Stebila, and Veitch (CCS '24) proposed a post-quantum variant pq-obfs, using a novel building block called obfuscated key encapsulation mechanisms (OKEMs): KEMs whose public keys and ciphertexts look like random bitstrings.

For transitioning real-world protocols, pure post-quantum security is not enough. Many are taking a hybrid approach, combining traditional and post-quantum schemes to hedge against security failures in either component. While hybrid KEMs are already widely deployed (e.g., in TLS 1.3), existing hybridization techniques fail to provide hybrid obfuscation guarantees for OKEMs. Further, even if a hybrid OKEM existed, the pq-obfs protocol would still not achieve hybrid obfuscation.

In this work, we address these challenges by presenting the first OKEM combiner that achieves hybrid IND-CCA security with hybrid ciphertext obfuscation guarantees, and using this to build Drivel, a modification of pq-obfs that is compatible with hybrid OKEMs. Our OKEM combiner allows for a variety of practical instantiations, e.g., combining obfuscated versions of DHKEM and ML-KEM. We additionally provide techniques to achieve unconditional public key obfuscation for LWE-based OKEMs, and explore broader applications of hybrid OKEMs, including a construction of the first hybrid password-authenticated key exchange (PAKE) protocol secure against adaptive corruptions in the UC model.
