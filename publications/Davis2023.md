---
title: "Verifiable Distributed Aggregation Functions"
year: 2023
location: The 23rd Privacy Enhancing Technologies Symposium (PETS), July 10-15, Lausanne, Switzerland. 2023.
authors:
  - hannah-davis
  - christopher-patton
  - mike-rosulek
  - Phillipp Schoppmann
url: https://petsymposium.org/popets/2023/popets-2023-0126.pdf
related_interests:
  - privacy
  - protocols
  - cryptography
---

The modern Internet is built on systems that incentivize collection of information about users. In order to minimize privacy loss, it is desirable to prevent these systems from collecting more information than is required for the application. The promise of multi-party computation is that data can be aggregated without revealing individual measurements to the data collector. This work offers aprovable security treatment for “Verifiable Distributed Aggregation Functions (VDAFs)”, a class of multi-party computation protocols being considered for standardization by the IETF.

We propose a formal framework for the analysis of VDAFs and apply it to two constructions. The first is Prio3, one of the candidates for standardization. This VDAF is based on the Prio system of Corrigan-Gibbs and Boneh (NSDI 2017). We prove that Prio3 achieves our security goals with only minor changes to the draft. The second construction, called Doplar, is introduced by this paper. Doplar is a round-reduced variant of the Poplar system of Boneh et al. (IEEE S&P 2021), itself a candidate for standardization. The cost of this improvement is a modest increase in overall bandwidth andcomputation.
