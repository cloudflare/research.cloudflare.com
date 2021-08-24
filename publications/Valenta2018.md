---
title: "In search of CurveSwap: Measuring elliptic curve implementations in the wild"
year: 2018
location: 2018 IEEE European Symposium on Security and Privacy (EuroS&P), pp. 384-398. IEEE, 2018.
authors:
  - luke-valenta
  - nick-sullivan
  - Antonio Sanso
  - Nadia Heninger
url: https://ieeexplore.ieee.org/abstract/document/8406612
related_areas:
  - cryptography
  - measurement
related_projects:
  - 
---

We survey elliptic curve implementations from several vantage points. We perform internet-wide scans for TLS on a large number of ports, as well as SSH and IPsec to measure elliptic curve support and implementation behaviors, and collect passive measurements of client curve support for TLS. We also perform active measurements to estimate server vulnerability to known attacks against elliptic curve implementations, including support for weak curves, invalid curve attacks, and curve twist attacks. We estimate that 1.53% of HTTPS hosts, 0.04% of SSH hosts, and 4.04% of IKEv2 hosts that support elliptic curves do not perform curve validity checks as specified in elliptic curve standards. We describe how such vulnerabilities could be used to construct an elliptic curve parameter downgrade attack called CurveSwap for TLS, and observe that there do not appear to be combinations of weak behaviors we examined enabling a feasible CurveSwap attack in the wild. We also analyze source code for elliptic curve implementations, and find that a number of libraries fail to perform point validation for JSON Web Encryption, and find a flaw in the Java and NSS multiplication algorithms.
