---
title: "RFC 9180: Hybrid Public Key Encryption"
year: 2022
location: Internet Research Task Force (IRTF). 2022.
authors:
  - Richard Barnes
  - Karthik Bhargavan
  - Benjamin Lipp
  - christopher-wood
url: https://datatracker.ietf.org/doc/rfc9180/
related_interests:
  - cryptography
---

This document describes a scheme for hybrid public key encryption (HPKE). This scheme provides a variant of public key encryption of arbitrary-sized plaintexts for a recipient public key. It also includes three authenticated variants, including one that authenticates possession of a pre-shared key and two optional ones that authenticate possession of a key encapsulation mechanism (KEM) private key. HPKE works for any combination of an asymmetric KEM, key derivation function (KDF), and authenticated encryption with additional data (AEAD) encryption function. Some authenticated variants may not be supported by all KEMs. We provide instantiations of the scheme using widely used and efficient primitives, such as Elliptic Curve Diffie-Hellman (ECDH) key agreement, HMAC-based key derivation function (HKDF), and SHA2.

This document is a product of the Crypto Forum Research Group (CFRG) in the IRTF.
