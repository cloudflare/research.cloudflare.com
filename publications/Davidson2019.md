---
title: Strong post-compromise secure proxy re-encryption
year: 2019
location: Australasian Conference on Information Security and Privacy, pp. 58-77. Springer, Cham, 2019.
authors:
  - Alex Davidson
  - Amit Deo
  - Ela Lee
  - Keith Martin
url: https://eprint.iacr.org/2019/368.pdf
doi: 10.1007/978-3-030-21548-4_4
related_interests:
  - cryptography
---

Proxy Re-Encryption (PRE), introduced by Blaze et. al in [BBS98], allows a ciphertext encrypted using a key pki to be re-encrypted by a third party so that it is an encryption of the same message under a new key pkj, without revealing the message. Post-Compromise Security (PCS) was first introduced for messaging protocols, and ensures that a ciphertext remains confidential even when past keys have been corrupted. We define PCS in the context of PRE, which ensures that an adversary cannot distinguish which ciphertext a re-encryption was created from even given the old secret key, potential old ciphertexts and update token used to perform the re-encryption. We argue that this formal notion accurately captures the most intuitive form of PCS. We give separating examples demonstrating how our definition is stronger than existing ones, before showing that PCS can be met using a combination of existing security definitions from the literature. In doing so, we show that there are existing PRE schemes that satisfy PCS. We also show that natural modifications of more practical PRE schemes can be shown to have PCS without relying on this combination of existing security definitions. Finally, we discuss the relationship between PCS with selective versus adaptive key corruptions, giving a theorem that shows how adaptive security can be met for certain re-encryption graphs.
