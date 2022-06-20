---
title: Cryptographic Attestation of Personhood
related_profiles:
  - tara-whalen
  - thibault-meunier
  - nick-sullivan
  - peter-wu
  - armando-faz
  - wesley-evans
  - marwan-fayed
  - cefan-rubin
related_publications:
  - Faz-Hernandez
# related_areas:
#  - cryptography
#  - privacy
#  - authentication 
resources:
  - text: More devices, fewer CAPTCHAs, happier users
    blog: https://blog.cloudflare.com/cap-expands-support/
  - text: Introducing Zero-Knowledge Proofs for Private Web Attestation with Cross/Multi-Vendor Hardware
    blog: https://blog.cloudflare.com/introducing-zero-knowledge-proofs-for-private-web-attestation-with-cross-multi-vendor-hardware/
  - text: Humanity wastes about 500 years per day on CAPTCHAs. It’s time to end this madness
    blog: https://blog.cloudflare.com/introducing-cryptographic-attestation-of-personhood/
  - text: Zero-Knowledge Proofs for Private Web Attestation
    cfstream: 3c38fd90e525b02115c0e02342b2f363
  - text: "ZKAttest: Ring and Group Signatures for Existing ECDSA Keys"
    youtube: https://www.youtube.com/embed/47ZRZDJR1BA
  - text: ZKAttest Source Code
    link: https://github.com/cloudflare/zkp-ecdsa
---

<img src="https://blog.cloudflare.com/content/images/2021/04/image2-36.png" alt="Cryptographic Attestation of Personhood" width="300" align="right" />

Cryptographic Attestation of Personhood provides two of alternatives to CAPTCHAs to prove you are not a robot: 
- security keys (USB and NFC keys that are certified by the [FIDO alliance](https://fidoalliance.org/metadata/?cf_target_id=BDD605A30995AB513BD1D490FD5530EE]) and
- biometric authenticators (like Apple's Face ID, Microsoft Hello, and Android Biometric Authentication).

You can try it out on our [demo site](https://cloudflarechallenge.com) and let us know your feedback.
