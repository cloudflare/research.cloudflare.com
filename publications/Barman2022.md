---
title: "This is not the padding you are looking for! On the ineffectiveness of QUIC PADDING against website fingerprinting"
year: 2022
location: IETF 113 Conference. 2022.
authors:
  - Ludovic Barman
  - Sandra Siby
  - christopher-wood
  - marwan-fayed
  - nick-sullivan
  - Carmela Troncoso
url: https://arxiv.org/abs/2203.07806
doi: 10.48550/arXiv.2203.07806
related_areas:
  - cryptography
  - security
---

Website fingerprinting (WF) is a well-know threat to users' web privacy. New internet standards, such as QUIC, include padding to support defenses against WF. We study whether network-layer padding can indeed be used to construct effective WF defenses. We confirm previous claims that network-layer padding cannot provide good protection against powerful adversaries capable of observing all traffic traces. In contrast to prior work, we also demonstrate that such padding is ineffective even against adversaries with partial view of the traffic. Network-layer padding without application input is ineffective because it fails to hide information unique across different applications. We show that application-layer padding solutions need to be deployed by both first and third parties, and that they can only thwart traffic analysis in limited situations. We identify challenges to deploy effective WF defenses and provide recommendations to reduce these hurdles.
