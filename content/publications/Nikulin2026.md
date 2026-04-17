---
title: "Unweight: Lossless MLP Weight Compression for LLM Inference"
year: 2026
date: 2026-04-17
location: "Cloudflare Technical Report Cf-TR-2026.04.v1, April 2026"
authors:
  - ivan-nikulin
url: /papers/unweight-2026.pdf
related_interests:
  - machine learning
  - compression
  - gpu systems
pillar: fast
metaDescription: "Unweight is a lossless compression system for LLM weight tensors achieving 1.44x compression on BF16 MLP weights with GPU-native decompression for inference on NVIDIA Hopper GPUs."
---

Unweight is a research program on lossless compression of LLM weight tensors, with active work on dense inference, model distribution, and Mixture-of-Experts serving. This report presents intermediate results from the engineering stream: a composable GPU toolkit whose components can be assembled for these deployment scenarios on NVIDIA Hopper GPUs (H100, H200).

It is well established in prior work (DFloat11, ZipServ, ZipNN) that BF16 exponent fields in trained LLM weights carry ~2.6 bits of Shannon entropy in their 8-bit allocation, while sign and mantissa fields are near-incompressible.

Unweight separates each BF16 value into sign+mantissa and exponent, Huffman-codes the exponents over a per-tensor 16-value palette, and handles rare exponents through verbatim rows rather than inline escape symbols. The compressed representation, execution pipelines, and runtime scheduling are independently configurable: a model can be Huffman-encoded for distribution and transcoded to a palette intermediate representation on load for inference.

Three execution pipelines—full decode to cuBLAS, exponent decode with reconstructive matmul, and palette transcode with reconstructive matmul—are selected per projection and batch-size bucket via coordinate-descent autotuning on end-to-end throughput.
