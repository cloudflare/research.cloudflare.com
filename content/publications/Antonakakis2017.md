---
title: Understanding the mirai botnet
year: 2017
location: 26th USENIX security symposium (USENIX Security 17), pp. 1093-1110. 2017.
authors:
  - manos-antonakakis
  - tim-april
  - michael-bailey
  - matt-bernhard
  - elie-bursztein
  - jaime-cochran
  - zakir-durumeric
  - j-alex-halderman
  - luca-invernizzi
  - michalis-kallitsis
  - deepak-kumar
  - chaz-lever
  - zane-ma
  - joshua-mason
  - damian-menscher
  - chad-seaman
  - nick-sullivan
  - kurt-thomas
  - yi-zhou
url: https://www.usenix.org/system/files/conference/usenixsecurity17/sec17-antonakakis.pdf
doi: 10.5555/3241189.3241275
related_interests:
  - malware
  - measurement
pillar: safe
metaDescription: "Seven-month retrospective analysis of the Mirai botnet's growth to 600k infections, examining how IoT devices were compromised and the evolution of DDoS attacks that threatened high-profile targets in 2016."
---

The Mirai botnet, composed primarily of embedded and IoT devices, took the Internet by storm in late 2016 when it overwhelmed several high-profile targets with massive distributed denial-of-service (DDoS) attacks. In this paper, we provide a seven-month retrospective analysis of Mirai’s growth to a peak of 600k infections and a history of its DDoS victims. By combining a variety of measurement perspectives, we analyze how the botnet emerged, what classes of devices were affected, and how Mirai variants evolved and competed for vulnerable hosts. Our measurements serve as a lens into the fragile ecosystem of IoT devices. We argue that Mirai may represent a sea change in the evolutionary development of botnets—the simplicity through which devices were infected and its precipitous growth, demonstrate that novice malicious techniques can compromise enough low-end devices to threaten even some of the best-defended targets. To address this risk, we recommend technical and nontechnical interventions, as well as propose future research directions.
