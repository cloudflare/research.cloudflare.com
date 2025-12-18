---
title: "Guiding simulations of multi-tier storage caches using knee detection"
year: 2023
location: "2023 31st International Symposium on Modeling, Analysis, and Simulation of Computer and Telecommunication Systems (MASCOTS), pages 1-8"
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
doi: 10.1109/MASCOTS59514.2023.10387545
related_interests:
  - workload analysis
  - storage
---

Simulating storage cache hierarchies enables efficient exploration of their configuration space, including diverse
topologies, parameters and policies, and devices with varied
performance characteristics, while avoiding expensive physical
experiments. Miss Ratio Curves (MRCs) efficiently characterize
the performance of a cache over a range of cache sizes. These
useful tools reveal “key points” for cache simulation, such
as knees in the curve that immediately follow sharp cliffs.
Unfortunately, there are no automated techniques for efficiently
finding key points in MRCs, and the cross-application of existing
knee-detection algorithms yields inaccurate results.
We present a multi-stage framework that identifies key points
in any MRC, for both stack-based (e.g., LRU) and more sophisticated eviction algorithms (e.g., ARC). Our approach quickly
locates candidates using efficient hash-based sampling, curve
simplification, knee detection, and novel post-processing filters.
We introduce Z-Method, a new multi-knee detection algorithm
that employs statistical outlier detection to choose promising
points robustly and efficiently.
