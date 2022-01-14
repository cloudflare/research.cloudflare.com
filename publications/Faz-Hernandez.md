---
title: "ZKAttest: Ring and Group Signatures for existing ECDSA keys"
year: 2021
location: Selected Areas in Cryptography (SAC 2021). To appear (2021).
authors:
  - armando-faz
  - Watson Ladd
  - deepak-maram
url: https://eprint.iacr.org/2021/1183
related_areas:
  - cryptography
---

Cryptographic keys are increasingly stored in dedicated hardware or behind software interfaces. Doing so limits access, such as permitting only signing via ECDSA. This makes using them in existing ring and group signature schemes impossible as these schemes assume the ability to access the private key for other operations. We present a Σ-protocol that uses a committed public key to verify an ECDSA or Schnorr signature on a message, without revealing the public key. We then discuss how this protocol may be used to derive ring signatures in combination with Groth–Kohlweiss membership proofs and other applications. This scheme has been implemented and source code is freely available.
