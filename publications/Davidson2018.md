---
title: "Privacy Pass: Bypassing Internet Challenges Anonymously"
year: 2018
location: Proceedings on Privacy Enhancing Technologies, no. 3 (2018), pp. 164-180. 2018.
authors:
  - alex-davidson
  - Ian Goldberg
  - nick-sullivan
  - George Tankersley
  - Filippo Valsorda
url: https://doi.org/10.1515/popets-2018-0026
related_areas:
  - privacy
  - authentication
  - cryptography
---

The growth of content delivery networks (CDNs) has engendered centralized control over the serving of internet content. An unwanted by-product of this growth is that CDNs are fast becoming global arbiters for which content requests are allowed and which are blocked in an attempt to stanch malicious traffic. In particular, in some cases honest users — especially those behind shared IP addresses, including users of privacy tools such as Tor, VPNs, and I2P — can be unfairly targeted by attempted ‘catch-all solutions’ that assume these users are acting maliciously. In this work, we provide a solution to prevent users from being exposed to a disproportionate amount of internet challenges such as CAPTCHAs. These challenges are at the very least annoying and at their worst — when coupled with bad implementations — can completely block access from web resources. We detail a 1-RTT cryptographic protocol (based on an implementation of an oblivious pseudorandom function) that allows users to receive a significant amount of anonymous tokens for each challenge solution that they provide. These tokens can be exchanged in the future for access without having to interact with a challenge. 

We have implemented our initial solution in a browser extension named “Privacy Pass”, and have worked with the Cloudflare CDN to deploy compatible server-side components in their infrastructure. However, we envisage that our solution could be used more generally for many applications where anonymous and honest access can be granted (e.g., anonymous wiki editing). The anonymity guarantee of our solution makes it immediately appropriate for use by users of Tor/VPNs/I2P. We also publish figures from Cloudflare indicating the potential impact from the global release of Privacy Pass.
