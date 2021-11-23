---
title: "Does certificate transparency break the web? Measuring adoption and error rate"
year: 2019
location: 2019 IEEE Symposium on Security and Privacy (SP), pp. 211-226. 2019.
authors:
  - Emily Stark
  - Ryan Sleevi
  - Rijad Muminovic
  - Devon O'Brien
  - Eran Messeri
  - Adrienne Porter Felt
  - Brendan Mcmillion
  - Parisa Tabriz
url: https://ieeexplore.ieee.org/abstract/document/8835212
doi: 10.1109/SP.2019.00027
related_areas:
  - security
---

Certificate Transparency (CT) is an emerging system for enabling the rapid discovery of malicious or misissued certificates. Initially standardized in 2013, CT is now finally beginning to see widespread support. Although CT provides desirable security benefits, web browsers cannot begin requiring all websites to support CT at once, due to the risk of breaking large numbers of websites. We discuss challenges for deployment, analyze the adoption of CT on the web, and measure the error rates experienced by users of the Google Chrome web browser. We find that CT has so far been widely adopted with minimal breakage and warnings. Security researchers often struggle with the tradeoff between security and user frustration: rolling out new security requirements often causes breakage. We view CT as a case study for deploying ecosystem-wide change while trying to minimize end user impact. We discuss the design properties of CT that made its success possible, as well as draw lessons from its risks and pitfalls that could be avoided in future large-scale security deployments.