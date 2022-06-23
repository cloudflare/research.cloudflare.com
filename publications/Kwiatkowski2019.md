---
title: Measuring TLS key exchange with post-quantum KEM
year: 2019
location: Workshop Record of the Second PQC Standardization Conference. 2019.
authors:
  - Krzysztof Kwiatkowski
  - nick-sullivan
  - Adam Langley
  - Dave Levin
  - Alan Mislove
url: https://www.cs.umd.edu/~dml/papers/pqc_nist19.pdf
related_interests:
  - cryptography
  - security
  - measurement
---

NIST is in the process of selecting new post-quantum cryptographic algorithms that are secure against both quantum (PQ) and classical computers. NIST has selected a few candidates from among all submissions for further consideration and study.
Our goal is to understand how these algorithms act when used by real clients over real networks, particularly candidate algorithms with a significant difference in public-key or ciphertext sizes. Our focus is on how different key sizes affect handshake time in the context of Transport Layer Security (TLS) as used on the web in HTTPS. Our two primary candidates are NTRU-based HRSS and isogeny-based SIKE. The following table shows a few characteristics for both algorithms. Performance characteristics are from running the BoringSSL speed test on an Intel Skylake CPU.
