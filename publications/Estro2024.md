---
title: "Accelerating multi-tier storage cache simulations using knee detection"
year: 2024
location: "Journal of Performance Evaluation, 164, 102410"
authors:
  - Mario Antunes
  - Tyler Estro
  - Pranav Bhandari
  - Anshul Gandhi
  - Geoff Kuenning
  - Yifei Liu
  - Carl Waldspurger
  - avani-wildani
  - Erez Zadok
doi: 10.1016/j.peva.2024.102410
related_interests:
  - workload analysis
  - storage
---

Storage cache hierarchies include diverse topologies, assorted parameters and policies, and
devices with varied performance characteristics. Simulation enables efficient exploration of their
configuration space while avoiding expensive physical experiments. Miss Ratio Curves (MRCs)
efficiently characterize the performance of a cache over a range of cache sizes, revealing “key
points” for cache simulation, such as knees in the curve that immediately follow sharp cliffs.
Unfortunately, there are no automated techniques for efficiently finding key points in MRCs, and
the cross-application of existing knee-detection algorithms yields inaccurate results.
We present a multi-stage framework that identifies key points in any MRC, for both stackbased (e.g., LRU) and more sophisticated eviction algorithms (e.g., ARC). Our approach quickly
locates candidates using efficient hash-based sampling, curve simplification, knee detection, and
novel post-processing filters. We introduce Z-Method, a new multi-knee detection algorithm that
employs statistical outlier detection to choose promising points robustly and efficiently.
