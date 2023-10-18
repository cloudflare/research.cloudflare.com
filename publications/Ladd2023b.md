---
title: "Portunus: Re-imagining access control in distributed systems using attribute-based encryption"
year: 2023
location: Real World Crypto Symposium 2023. Tokyo, Japan. March 2023.
authors:
  - Watson Ladd
  - Marloes Venema
  - tanya-verma
url: https://iacr.org/submit/files/slides/2023/rwc/rwc2023/83/slides.pptx
related_interests:
  - distributed_systems
  - cryptography
---

This talk presents Portunus, a global system used by Cloudflare to restrict where in the world a customer's TLS private keys can be accessed based on some policy. It is an RBAC system built using ciphertext-policy attribute-based encryption, a variant of public-key cryptography introduced in 2005, that enables access control to be enforced with minimal dependence on a central authority. Using Portunus as an example, we discuss the benefits of employing attribute-based encryption (ABE) to construct access control systems for distributed settings. Portunus evolved from an earlier system, Geo Key Manager, previously presented at RWC 2018. Prompted by a question from the audience, we attacked the inflexible policies and vulnerability to collusion by replacing a home-grown simulation of an ABE-like scheme using Identity Based Encryption and Broadcast Encryption, with an established ABE scheme by TKN. This shortcoming was validated when customers demanded richer data restriction policies to reflect the increasing balkanization of the Internet in response to regulations such as GDPR. However, it is not enough to drop in a new scheme: real-world systems have to deal with attribute changes, key rotation, performance needs, and high loads. It also needs to address the needs of real users. This talk will discuss the translation of a ciphertext-policy ABE scheme from theory to practice and the hurdles along the way, as well as show how successful application of an imperfect cryptographic solution paved the way for adoption of a theoretically more satisfying and more capable solution.
