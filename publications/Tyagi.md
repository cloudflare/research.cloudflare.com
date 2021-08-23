---
title: A Fast and Simple Partially Oblivious PRF, with Applications
year: 
location: Under submission, 2021
authors:
  - Nirvan Tyagi
  - sofia-celi
  - thomas-ristenpart
  - nick-sullivan
  - Stefano Tessaro
  - christopher-wood
url: https://eprint.iacr.org/2021/864.pdf
related_areas:
  - cryptography
related_projects:
  - 
---

We build the first construction of a partially oblivious pseudorandom function (POPRF) that does not rely on bilinear pairings. Our construction can be viewed as combining elements of the 2HashDH OPRF of Jarecki, Kiayias, and Krawczyk with the Dodis-Yampolskiy PRF. We analyze our POPRF’s security in the random oracle model via reduction to a new one-more gap strong Diffie-Hellman inversion assumption. The most significant technical challenge is establishing confidence in the new assumption, which requires new proof techniques that enable us to show that its hardness is implied by the q-DL assumption in the algebraic group model.
Our new construction is as fast as the current, standards-track OPRF 2HashDH protocol, yet provides a new degree of flexibility useful in a variety of applications. We show how POPRFs can be used to prevent token hoarding attacks against Privacy Pass, reduce key management complexity in the OPAQUE password authenticated key exchange protocol, and ensure stronger security for password breach alerting services.
