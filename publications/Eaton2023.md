---
title: "Security Analysis of Signature Schemes with Key Blinding"
year: 2023
authors: 
  - Edward Eaton 
  - Tancrède Lepoint
  - christopher-wood
url: https://eprint.iacr.org/2023/380
related_interests:
  - cryptography
  - protocols
---
Digital signatures are fundamental components of public key cryptography. They allow a signer to generate verifiable and unforgeable proofs---signatures---over arbitrary messages with a private key, and allow recipients to verify the proofs against the corresponding and expected public key. These properties are used in practice for a variety of use cases, ranging from identity or data authenticity to non-repudiation. Unsurprisingly, signature schemes are widely used in security protocols deployed on the Internet today.

In recent years, some protocols have extended the basic syntax of signature schemes to support key blinding, a.k.a., key randomization. Roughly speaking, key blinding is the process by which a private signing key or public verification key is blinded (randomized) to hide information about the key pair. This is generally done for privacy reasons and has found applications in Tor and Privacy Pass.

Recently, Denis, Eaton, Lepoint, and Wood proposed a technical specification for signature schemes with key blinding in an IETF draft. In this work, we analyze the constructions in this emerging specification. We demonstrate that the constructions provided satisfy the desired security properties for signature schemes with key blinding. We experimentally evaluate the constructions and find that they introduce a very reasonable 2-3x performance overhead compared to the base signature scheme. Our results complement the ongoing standardization efforts for this primitive.