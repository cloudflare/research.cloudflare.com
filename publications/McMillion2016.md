---
title: Attacking White-Box AES Constructions
year: 2016
location: Proceedings of the 2016 ACM Workshop on Software Protection, pp. 85-90. 2016.
authors: 
  - brendan-mcmillion
  - nick-sullivan
url: http://library.usc.edu.ph/ACM/SIGSAC%202017/spro/p85.pdf
related_areas:
  - cryptography
related_projects:
  - 
---

A white-box implementation of the Advanced Encryption Standard (AES) is a software implementation which aims to prevent recovery of the block cipher's master secret key. This paper refines the design criteria for white-box AES constructions by describing new attacks on past proposals which are conceptually very simple and introduces a new family of white-box AES constructions. Our attacks have a decomposition phase, followed by a disambiguation phase. The decomposition phase applies an SASAS-style cryptanalysis to convert the implementation into a simpler form, while the disambiguation phase converts the simpler form into a unique canonical form. It's then trivial to recover the master secret key of the implementation from its canonical form. We move on to discuss the hardness of SPN disambiguation as a problem on its own, and how to construct white-boxes from it. Implementations of all described attacks and constructions are provided on GitHub at [https://github.com/OpenWhiteBox/](https://github.com/OpenWhiteBox/).
