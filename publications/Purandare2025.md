---
title: "Valet: Efficient Data Placement on Modern SSDs"
year: 2025
location: "ACM Symposium on Cloud Computing 2025 (best paper)"
authors:
  - Devashish R. Purandare
  - Peter Alvaro
  - avani-wildani
  - Darrell D. E. Long
  - Ethan L. Miller
url: https://arxiv.org/abs/2501.00977
related_interests:
  - storage
---

The increasing demand for SSDs coupled with scaling difficulties has left manufacturers scrambling for newer SSD interfaces which promise better performance and durability. While these interfaces reduce the rigidity of traditional abstractions, they require application or system-level changes that can impact the stability, security, and portability of systems. To make matters worse, such changes are rendered futile with the introduction of next-generation interfaces. It is therefore no surprise that such interfaces have seen limited adoption, leaving behind a graveyard of experimental interfaces ranging from open-channel SSDs to stream SSDs.
Our solution, Valet, leverages userspace shim layers to add placement hints for application data, delivering up to 2-4x write throughput over filesystems and comparable or better performance than application-specific solutions, with up to 6x lower tail latency. Valet generates dynamic placement hints, remapping application data to modern SSDs with zero modifications to the application, the filesystem, or the kernel. We demonstrate performance, efficiency, and multi-tenancy benefits of Valet across a set of widely-used applications: RocksDB, MongoDB, and CacheLib, presenting a solution that combines the performance of application-specific solutions with wide applicability to log-structured data-intensive applications.
