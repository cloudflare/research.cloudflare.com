---
title: "Rethinking the Networking Stack for Serverless Environments: A Sidecar Approach"
year: 2024
location: "Proceedings of the 2024 ACM Symposium on Cloud Computing"
authors:
  - Vishwanath Seshagiri
  - Abhinav Gupta
  - Vahab Jabrayilov
  - avani-wildani
  - Kostis Kaffes
doi: 10.1145/3698038.3698561
related_interests:
  - storage
---

Serverless platforms rely onlegacy networking stacks for communication and data movement. We quantitatively analyze
the performance of these stacks and show their mismatch with
highly consolidated, virtualized modern serverless environments, focusing on Firecracker, the most common serverless
virtualization framework. As serverless applications grow in
complexity and interaction, the resulting network bottleneck
is a prime source of user-perceived, end-to-end latency. In this
paper, we present a detailed vision of a new, sidecar-based
networking stack for serverless environments. Our primary
design goal is to provide low-overhead networking while
maintaining existing security guarantees. We outline the research challenges in both the control and the data plane that
the community needs to tackle before such a sidecar architecture can be used in practice.
