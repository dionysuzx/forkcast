# EIP-8141 Context

Generated: 2026-01-30

## Raw EIP Content
Source: https://github.com/ethereum/EIPs/blob/master/EIPS/eip-8141.md
```
---
eip: 8141
title: Frame Transaction
description: Add frame abstraction for transaction validation, execution, and gas payment
author: Vitalik Buterin (@vbuterin), lightclient (@lightclient), Felix Lange (@fjl), Yoav Weiss (@yoavw), Alex Forshtat (@forshtat), Dror Tirosh (@drortirosh), Shahaf Nacson (@shahafn)
discussions-to: https://ethereum-magicians.org/t/frame-transaction/27617
status: Draft
type: Standards Track
category: Core
created: 2026-01-29
requires: 2718, 4844
---

## Abstract

Add a new transaction whose validity and gas payment can be defined abstractly. Instead of relying solely on a single ECDSA signature, accounts may freely define and interpret their signature scheme using any cryptographic system.

## Motivation

This new transaction provides a native off-ramp from the elliptic curve based cryptographic system used to authenticate transactions today, to post-quantum (PQ) secure systems.

In doing so, it realizes the original vision of account abstraction: unlinking accounts from a prescribed ECDSA key and support alternative fee payment schemes. The assumption of an account simply becomes an address with code. It leverages the EVM to support arbitrary *user-defined* definitions of validation and gas payment.

## Specification

### Constants

| Name                      | Value                                   |
| ------------------------- | --------------------------------------- |
| `FRAME_TX_TYPE`           | `0x06`                                  |
| `FRAME_TX_INTRINSIC_COST` | `15000`                                 |
| `ENTRY_POINT`             | `address(0xaa)`                         |
| `MAX_FRAMES`              | `10^3`                                  |

### Opcodes

| Name           | Value  |
| -------------- | ------ |
| `APPROVE`      | `0xaa` |
| `TXPARAMLOAD`  | `0xb0` |
| `TXPARAMSIZE`  | `0xb1` |
| `TXPARAMCOPY`  | `0xb2` |

### New Transaction Type

A new EIP-2718 transaction with type `FRAME_TX_TYPE` is introduced. Transactions of this type are referred to as "Frame transactions".

The payload is defined as the RLP serialization of the following:

[chain_id, nonce, sender, frames, max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas, blob_versioned_hashes]

frames = [[mode, target, gas_limit, data], ...]

### Modes

There are three modes:
- 0: DEFAULT - Execute frame as ENTRY_POINT
- 1: VERIFY - Frame identifies as transaction validation (static call, must terminate with APPROVE)
- 2: SENDER - Execute frame as sender (requires prior sender approval)

### New Opcodes

- APPROVE (0xaa): Like RETURN but with scope operand for approval types (execution, payment, or both)
- TXPARAM* opcodes: Environment access for transaction parameters (nonce, sender, fees, frame data, sig hash, etc.)

### Behavior

For each frame:
1. Execute call with specified mode, target, gas_limit, and data
2. If frame exits with approval status (2-4), update approval state
3. If frame has mode VERIFY and didn't terminate with approval, transaction is invalid
4. After all frames, verify payer_approved == true

### Gas Accounting

tx_gas_limit = FRAME_TX_INTRINSIC_COST + calldata_cost(rlp(tx.frames)) + sum(frame.gas_limit for all frames)

Each frame has its own gas_limit allocation. Unused gas from a frame is NOT available to subsequent frames.
```

## Commit History
Source: https://github.com/ethereum/EIPs/commits/master/EIPS/eip-8141.md
```
{"sha":"187d1ce","date":"2026-01-29","message":"Update EIP-8141: Fix status field number"}
{"sha":"723c9ca","date":"2026-01-29","message":"Update EIP-8141: fix typos"}
{"sha":"6f46a8c","date":"2026-01-29","message":"Add EIP: Frame Transaction"}
```

## Original PR Discussion
Source: https://github.com/ethereum/EIPs/pull/11202

### PR Metadata
- Title: Add EIP: Frame Transaction
- Author: fjl (Felix Lange)
- Created: 2026-01-29T03:20:59Z
- Body: (empty)

### Issue Comments
- eth-bot (2026-01-29): All reviewers have approved.
- github-actions (2026-01-29): CI errors on intermediate commit

### Review Comments
- abcoathup (2026-01-29): Assigned EIP number 8141, requested filename update
- abcoathup (2026-01-29): Added assigned number to discussions-to URL

## Eth Magicians Discussion Thread
Source: https://ethereum-magicians.org/t/eip-8141-frame-transaction/27617

### Posts (13 total)

**matt (2026-01-29T03:35:02Z)**
Add a new transaction whose validity and gas payment can be defined abstractly. Instead of relying solely on a single ECDSA signature, accounts may freely define and interpret their signature scheme using any cryptographic system.
[Links to PR #11202]

**thegaram33 (2026-01-29T13:14:25Z)**
This looks great! What happens if there are multiple VERIFY frames that return APPROVE(0x1) or APPROVE(0x2)? Does that invalidate the transaction, or the first/last will pay for gas?

**fjl (2026-01-29T13:36:25Z)**
As per Behavior section, if a frame exits with 2, 3, or 4, and the corresponding variable (sender_approved, payer_approved) is already set to true, the frame reverts. So only the first approval counts. Redundant/conflicting approvals do not invalidate the transaction.

**thegaram33 (2026-01-29T14:00:19Z)**
Makes sense. So it is possible that some frames revert, while the rest do not. Is there a way to implement "atomic multicall" functionality with this then? I.e. given multiple SENDER frames, either all of them succeed or all revert?

**fjl (2026-01-29T14:08:25Z)**
We do have that, using TXPARAMLOAD (0x15). You can also check for a revert by inspecting the effects of the frame. But performing multiple SENDER frames is equivalent to a single SENDER frame that batches the calls.

**Helkomine (2026-01-29T16:22:44Z)**
I think there's no need for multiple call frames at the protocol level, because the atomicity of these frames isn't organized efficiently enough. [...] Why are we willing to complicate the protocol by introducing new transaction formats and a lot of code when a simpler approach would be to periodically add new signature schemes/delete old signature schemes for the authorization_tuple?

**shemnon (2026-01-29T16:50:33Z)**
Before I dive in completely, is there any reason the DeFi use case wasn't listed in the examples? Frame 0 verify, Frame 1 approve, Frame 2 swap? I wonder if focusing examples on the PQ motivation undersells the immediate use case that the community has been asking to get for years.

**matt (2026-01-29T16:59:49Z)**
Mostly because defi use cases can be realized today with several mechanisms: smart accounts, 4337, 7702. [...] The motivation for 8141 is about solving the protocol's ECDSA problem in accounts. Obviously this has high overlap with AA and UX, and we should keep it in mind, we do primarily want to offer a robust and flexible platform to begin migrating accounts to.

**matt (2026-01-29T18:34:17Z)**
Frames are required to support introspection by the protocol. It's not about supporting multiple calls at the EVM layer. It's about allowing end users to flexibly define the way their transactions should be handled. The protocol can in turn, use the modes we're introducing to reason about the transaction and safely bound the resources needed to validate and propagate abstract transactions over p2p.

**Helkomine (2026-01-30T05:59:18Z)**
Your solution focuses on addressing issues related to the originator, which I believe is a minor issue that we can solve using a minor solution. [...] I prefer more sustainable long-term solutions (reducing the cost of the opcode, adding new signature schemes, lock EOA, ...).

**matt (2026-01-30T13:25:33Z)**
To move away from ECDSA, we either 1) need a tx type with a predefined set of whitelisted (PQ) cryptographic algos 2) need to allow smart accounts to originate transactions. Obviously 2) is far more compatible with the Ethereum philosophy of giving users powerful primitives.

**Helkomine (2026-01-30T16:44:59Z)**
Your solution focuses on addressing issues related to the originator, which I believe is a minor issue that we can solve using a minor solution. [...] What I mean is we don't need to choose exactly one rigid scheme, but just change the scheme periodically.

**matt (2026-01-30T17:08:18Z)**
It's not about the value of ORIGIN, it's about origination. It's about sending a transaction. Today to pay the block builder to include a transaction there is only 1 pathway: via EOA. The frame transaction adds a second pathway: via code. [...] We have already attempted a simpler proposal than EIP-8141 when we proposed EIP-2938. It was simpler and allowed you very arbitrarily define the smart contract system to determine the validity, PAYGAS, and execute calls. But it failed due to the lack of protocol-level introspection. The frame transaction is a direct response to this.

## Headliner Proposal
Source: https://ethereum-magicians.org/t/hegota-headliner-proposal-frame-transaction/27618

### Posts (4 total)

**matt (2026-01-29T03:49:14Z)**
Frame Transaction EIP: [PR #11202]

## Summary (ELI5)
A new transaction type where validation and gas payment are defined by smart contract code instead of enshrined ECDSA signatures. This enables:
- Post-quantum security: Accounts can use any signature scheme
- Native account abstraction: Flexible wallets with social recovery, multi-sig, spending limits
- Gas sponsorship: Someone else can pay your fees natively

Beneficiaries: End users (better UX and safety), wallet developers, the network (PQ migration path)

## Champion
Felix Lange (@fjl) and lightclient (@lightclient)

## Justification

### Why This Matters
| Benefit | Rationale |
| PQ security | ECDSA will break; users can migrate to quantum-resistant signatures at their pace |
| Native AA | More efficient than ERC-4337; eliminates intermediaries for mempool/bundler infrastructure. Better at "walk away" test |
| Gas flexibility | Native sponsorship support; ERC-20 gas payments without trusted intermediaries |

### Why Now
- Quantum threat requires proactive migration (10+ year timeline, but migration is slow).
- ERC-4337 validated demand and design patterns. Time to enshrine.
- EIP-7702 already changed ORIGIN semantics, reducing this proposal's disruption.

### Why This Approach
| Alternative | Limitation |
| ERC-4337 | Separate mempool, bundlers, higher overhead |
| EIP-7701 | Overly specific about particular flows, not easy to generalize in client impl |
| EIP-7702 | Useful but solves different problem; not PQ |
| PQ tx type | Simpler, but there may be many PQ schemes that are desirable. And, it doesn't allow us to achieve other long term goals, like key rotation. |

### Technical Readiness
- Transaction format: Complete
- New opcodes (APPROVE, TXPARAM*): Complete
- Gas accounting: Complete
- Mempool rules: Defined in ERC-7562
- Reference implementation: Not started
- Test vectors: Not started

### Known Risks
1. Mempool DoS: Mass invalidation via shared state. This is mitigated by validation restrictions from ERC-7562.

### Open Questions
1. Paymaster support: paymasters are established under ERC-4337. While this EIP aims to be compatible with them via same mempool rules, it is open question to see that materialize.

**oxshaman (2026-01-29T21:31:55Z)**
Great read! One question - does this imply that the plan is to continue down the path of 4337-Bundler-Style restrictions to state access. As I see the DoS mitigation is approached via ERC-7562 and MAX_VALIDATION_GAS. Is full state access being considered anymore or is it out of scope?

**matt (2026-01-29T21:49:51Z)**
I would say it's important to make the distinction between what does the protocol allow and what is allowed in public transaction pool. Our aim is to make the protocol maximally flexible, but start small and carefully expand what the public tx pool will allow.

Concretely to your question: full state access before the payer is approved in this proposal, however, you will need to find a builder who will include such a transaction. Our goal is to support self-sponsored transactions in the beginning and over time allow sponsor transactions (or other variants that gain popularity).

**vbuterin (2026-01-30T13:28:25Z)**
4337 already supports full state access via the paymaster mechanism. A paymaster also serves as a de-facto custom mempool acceptance rule, and the protocol acts as a sort of "meta-mempool-acceptance-rule" where anyone can stake ETH to add their mempool acceptance rule to the list, and if too many transactions pass that rule but do not get included onchain, then it gets throttled and then delisted (as a subjective decision by mempool nodes).

Since 8141 is a modification on 7701, and 7701 is itself an onchain version of 4337, this design can be applied as-is to make a mempool for 8141 transactions.

## Call Transcript
Source: acde/229 - public/artifacts/acde/2026-01-29_229/transcript_corrected.vtt

### Relevant Excerpts

**Ansgar Dietrichs (01:10:43)**
And keep the discussion alive. For today, I would then move on to the second presentation... frame transactions, proposed by Matt and Felix.

**Felix (Geth) (01:11:06-01:18:38)**
I can give the presentation. [...] this EIP is a proposal that is in the line of proposals for account abstraction. And, specifically, it has... For us, it's mostly about abstracting the transaction signature away to a system where the user account itself verifies the validity of the transaction, and more specifically, the account itself verifies whether the transaction was sent by itself.

there is a lot of existing... there were a lot of previous EIPs related to account abstraction, one of them being the EIP7701. this is, in some ways, an evolution of the EIP7701, and the ideas in this EIP, 8141, were co-developed with the team behind EIP7701, so it's kind of like the combination of all the ideas that various teams had.

[Explains frame modes: DEFAULT (unauthenticated from ENTRY_POINT), VERIFY (static call for signature verification), SENDER (authenticated mode)]

We feel like we just have to provide the means first, and then we have to work with everyone to build out their infrastructure, because there's almost no incentive to build another infrastructure for keys when the protocol doesn't support it.

**Daniel Lehrner (Besu) (01:19:03-01:21:23)**
Yeah, so my concerns about this are not so much technical, but we have seen with 7702 that the option for the smart wallets, or for any changes in how we do transaction signing is very, very low. [...] I'm a bit worried that we would do this as a headliner, as a preparation for post-quantum, but afterwards it's not really used. [...] I would say if we want to do benchmarks, we should at least consider the smart contract size increase for the next DevNet.

**Felix (Geth) (01:20:03-01:22:08)**
For me, it's quite clear that account abstraction has been one of these projects that has been ongoing for many years that people always wanted to realize, and we also see that the existing mechanisms that were proposed for in this direction, they are not adequate to capture what users really want to do. [...] Some bigger change is needed to really help people realize the things that they have to do.

It is our plan to communicate with the builders of wallets and other infrastructure to ensure that they can find a good upgrade path.

**Felix (Geth) (01:22:17-01:24:15)**
[On mempool concerns] for the purposes of the mempool, we will validate the transaction to conform to a specific known frame structure, and this includes having a gas limit on the signature verification. [...] in the public mempool, these transactions will be much more limited than their feature set might allow. [...] using the EVM to verify the signature isn't different from calling the ECDSA verification in the native code, it's just a different signature algorithm in the end.

**vitalik (01:24:30-01:26:29)**
from a use cases perspective, this does basically satisfy everything that at least I've been pushing for, the entire list of goals of account abstraction, including the original ones, and including various things that have been bolted onto the topic over the years. And I think it's particularly nice how this design has very few special purpose features from these things. They just fall out naturally from the ability to have multiple a verification frame and execution frames, so it satisfies the natural stuff, like different signature algorithms, including passkey friendliness, now that we also have the SIG P256R1 precompile, it satisfies post-quantum SIGs, it satisfies native multisig, it also... there's this nice synergy with FOCIL, where privacy protocols and also even transactions paid with Paymasters can be sent through it, and there's a path to make that FOCIL compatible without intermediaries, and so there's a benefit in terms of censorship resistance for privacy.

## Eth R&D Discord Context
Source: Eth R&D Discord (user-provided)

lightclient (1/28/26, 10:58 PM):
@fjl and I are proposing native account abstraction as the EL headliner for Hegota. We've been working with Vitalik to further generalize the previous native AA proposal EIP-7701 and have come up with the Frame Transaction. More here on the agenda: https://github.com/ethereum/pm/issues/1883#issuecomment-3815340368
EIP: https://eips.ethereum.org/EIPS/eip-8141

## Related EIPs

### EIP-2718 (Required)
Typed Transaction Envelope - defines the transaction type system that EIP-8141 extends with type 0x06.

### EIP-4844 (Required)
Shard Blob Transactions - blob-related fields (max_fee_per_blob_gas, blob_versioned_hashes) are included in frame transaction format.

### EIP-7701 (Predecessor)
Native Account Abstraction - EIP-8141 is described as an evolution of 7701, co-developed with the 7701 team.

### EIP-7702 (Related)
Set Code for EOAs - Referenced as solving a different problem (not PQ secure), but already changed ORIGIN semantics which reduces 8141's disruption.

### ERC-4337 (Related)
Account Abstraction Using Alt Mempool - Validated demand and design patterns. Frame transaction aims to be more efficient by eliminating bundler intermediaries.

### ERC-7562 (Related)
Account Abstraction Validation Scope Rules - Mempool rules for 8141 are defined to be compatible with 7562-style restrictions.
