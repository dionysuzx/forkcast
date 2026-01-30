# EIP-8141 Context

Generated: 2026-01-30

## Raw EIP Content
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

A new [EIP-2718](./eip-2718) transaction with type `FRAME_TX_TYPE` is introduced. Transactions of this type are referred to as "Frame transactions".

The payload is defined as the RLP serialization of the following:

```
[chain_id, nonce, sender, frames, max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas, blob_versioned_hashes]

frames = [[mode, target, gas_limit, data], ...]
```

If no blobs are included, `blob_versioned_hashes` must be an empty list and `max_fee_per_blob_gas` must be `0`.

#### Modes

There are three modes:

| Mode | Name           | Summary                                                   |
| ---- | -------------- | --------------------------------------------------------- |
|    0 | `DEFAULT`      | Execute frame as `ENTRY_POINT`                            |
|    1 | `VERIFY`       | Frame identifies as transaction validation                |
|    2 | `SENDER`       | Execute frame as `sender`                                 |

[Full EIP specification continues with detailed frame behavior, opcodes, gas accounting, examples, etc.]
```

## Commit History
```
{"sha":"187d1ce","date":"2026-01-29","message":"Update EIP-8141: Fix status field number"}
{"sha":"723c9ca","date":"2026-01-29","message":"Update EIP-8141: fix typos"}
{"sha":"6f46a8c","date":"2026-01-29","message":"Add EIP: Frame Transaction"}
```

## Original PR Discussion
PR: #11202 - Add EIP: Frame Transaction
URL: https://github.com/ethereum/EIPs/pull/11202

### PR Body
(Empty)

### Issue Comments
- eth-bot (2026-01-29T03:21:19Z): All reviewers have approved.
- github-actions (2026-01-29T03:51:27Z): The commit 9df7fe661fd9e11d23435ea57f2eb5260dcf7039 (as a parent of c83b98513bdef499f49ff01577eba64ba4071fe5) contains errors. Please inspect the Run Summary for details.

### Review Comments
None

### Reviews
None

## Eth Magicians Thread
URL: https://ethereum-magicians.org/t/frame-transaction/27617
(Thread returned empty posts - may be newly created or API issue)

## Headliner Proposal
URL: https://ethereum-magicians.org/t/hegota-headliner-proposal-frame-transaction/27618
Title: Hegota Headliner Proposal: Frame Transaction
Posts: 4
Created: 2026-01-29T03:49:14.054Z

### Posts

**matt (2026-01-29T03:49:14.172Z):**
Frame Transaction EIP: https://github.com/ethereum/EIPs/pull/11202

## Summary (ELI5)

A new transaction type where validation and gas payment are defined by smart contract code instead of enshrined ECDSA signatures. This enables:

- **Post-quantum security:** Accounts can use any signature scheme
- **Native account abstraction:** Flexible wallets with social recovery, multi-sig, spending limits
- **Gas sponsorship:** Someone else can pay your fees natively

**Beneficiaries:** End users (better UX and safety), wallet developers, the network (PQ migration path)

## Champion

Felix Lange (@fjl) and lightclient (@lightclient)

## Justification

### Why This Matters

| Benefit | Rationale |
|---------|-----------|
| PQ security | ECDSA will break; users can migrate to quantum-resistant signatures at their pace |
| Native AA | More efficient than ERC-4337; eliminates intermediaries for mempool/bundler infrastructure. Better at "walk away" test |
| Gas flexibility | Native sponsorship support; ERC-20 gas payments without trusted intermediaries |

### Why Now

- Quantum threat requires proactive migration (10+ year timeline, but migration is slow).
- ERC-4337 validated demand and design patterns. Time to enshrine.
- EIP-7702 already changed `ORIGIN` semantics, reducing this proposal's disruption.

### Why This Approach

| Alternative | Limitation |
|-------------|------------|
| ERC-4337 | Separate mempool, bundlers, higher overhead |
| EIP-7701 | Overly specific about particular flows, not easy to generalize in client impl |
| EIP-7702 | Useful but solves different problem; not PQ |
| PQ tx type | Simpler, but there may be many PQ schemes that are desirable. And, it doesn't allow us to achieve other long term goals, like key rotation. |

## Stakeholder Impact

### Positive

- **Users:** Better wallet UX, flexible security, gas sponsorship
- **Wallet/dApp devs:** Native AA infrastructure, easier onboarding
- **ERC-4337 ecosystem:** Natural migration path

### Negative

| Impact | Mitigation |
|--------|------------|
| Node DoS vectors from arbitrary validation | ERC-7562-style opcode restrictions; `MAX_VALIDATION_GAS` |
| `ORIGIN` behavior change | Already precedented by EIP-7702; pattern was discouraged |

## Technical Readiness

| Aspect | Status |
|--------|--------|
| Transaction format | Complete |
| New opcodes (APPROVE, TXPARAM*) | Complete |
| Gas accounting | Complete |
| Mempool rules | Defined in ERC-7562 |
| Reference implementation | Not started |
| Test vectors | Not started |

## Security & Open Questions

### Known Risks

1. **Mempool DoS:** Mass invalidation via shared state. This is mitigated by validation restrictions from ERC-7562.

### Open Questions

1. Paymaster support: paymasters are established under ERC-4337. While this EIP aims to be compatible with them via same mempool rules, it is open question to see that materialize. It will require working through the design with existing bundlers.

---

**oxshaman (2026-01-29T21:31:55.410Z):**
Great read!

One question - does this imply that the plan is to continue down the path of 4337-Bundler-Style restrictions to state access. As I see the DoS mitigation is approached via ERC-7562 and `MAX_VALIDATION_GAS`.

Is full state access being considered anymore or is it out of scope?

---

**matt (2026-01-29T21:49:51.459Z):**
Thank you!

I would say it's important to make the distinction between *what does the protocol allow* and *what is allowed in public transaction pool*. Our aim is to make the protocol maximally flexible, but start small and carefully expand what the public tx pool will allow.

Concretely to your question: full state access before the payer is approved in this proposal, however, you will need to find a builder who will include such a transaction. Our goal is to support self-sponsored transactions in the beginning and over time allow sponsor transactions (or other variants that gain popularity).

---

**vbuterin (2026-01-30T13:28:25.693Z):**
4337 already supports full state access via the paymaster mechanism.

A paymaster also serves as a de-facto custom mempool acceptance rule, and the protocol acts as a sort of "meta-mempool-acceptance-rule" where anyone can stake ETH to add their mempool acceptance rule to the list, and if too many transactions pass that rule but do not get included onchain, then it gets throttled and then delisted (as a subjective decision by mempool nodes).

Since 8141 is a modification on 7701, and 7701 is itself an onchain version of 4337, this design can be applied as-is to make a mempool for 8141 transactions.

## Call Transcript
Call: acde/229
File: public/artifacts/acde/2026-01-29_229/transcript_corrected.vtt

### Relevant Excerpts

**Ansgar Dietrichs (01:10:43 - 01:10:59):**
And keep the discussion alive. For today, I would then move on to the second presentation, because... so we can get through all three. So thank you, Yannick. And then next up will be, frame transactions, proposed by Matt and Felix.

**Felix (Geth) (01:11:20 - 01:11:29):**
So, this EIP is a proposal that is in the line of proposals for account abstraction. And, specifically, it has... For us, it's mostly about abstracting the transaction signature away to a system where the user account itself verifies the validity of the transaction.

**Felix (Geth) (01:12:22 - 01:12:43):**
This is, in some ways, an evolution of the EIP7701, and it... the ideas in this EIP, 8141, were co-developed with the team behind EIP7701, so it's kind of like, this is basically, like, the combination of all the ideas that various teams had.

**Felix (Geth) (01:13:00 - 01:13:08):**
We feel pretty good about this proposal, because a lot of these ideas that were previously already tested in ERC437 and during the EIP7701 development... there's, like, a lot, a lot, a lot of research behind it.

**Felix (Geth) (01:15:17 - 01:15:40):**
The fee payment is also decoupled from the sender, which is another goal of account abstraction, and it's also a goal that is specifically for the smart accounts and the wallets to be able to sponsor the transactions of their users.

**Felix (Geth) (01:18:11 - 01:18:15):**
We feel pretty comfortable with this design, and we are happy to defend it, and we propose it as the headliner, because we feel that it's a big change to the state transition.

**Felix (Geth) (01:18:15 - 01:18:38):**
And it's also kind of, for us, the most important one, because of the readiness for the post-quantum world, and I mean, we kind of feel like we have to get started with the off-ramp from ECDSA, and in order to do that, we need a comprehensive system that can deal with whatever signature algorithms we want to use.

**Daniel Lehrner (Besu) (01:19:17 - 01:19:41):**
My concerns about this are not so much technical, but we have seen with 7702 that the option for the smart wallets, or for any changes in how we do transaction signing is very, very low. I think I checked before in one of these dashboards, and we only have, like, 5,000 7702 transactions per day. I'm a bit worried that we would do this as a headliner, as a preparation for post-quantum, but afterwards it's not really used.

**Felix (Geth) (01:20:03 - 01:20:42):**
For me, it's quite clear that, like, account abstraction has been one of these projects that has been ongoing for many years that people always wanted to realize, and we also see that the existing mechanisms that were proposed for in this direction, they are not adequate to capture what users really want to do. Even now, with the EIP7702, it is kind of a... it is certainly a way to convert an existing account into an account with code, but it does not much more to help with the advanced use cases that people have, and also it is not quantum secure.

**Felix (Geth) (01:22:08 - 01:22:50):**
We feel like we just have to provide the means first, and then we have to work with everyone to build out their infrastructure, because there's almost no incentive to build another infrastructure for keys when the protocol doesn't support it and doesn't look like it will ever support it.

**Vitalik (01:24:30 - 01:25:15):**
From a use cases perspective, this does, like, basically satisfy, everything that, at least I've been pushing for, the entire list of goals of account abstraction, including the original ones, and including various things that have been bolted onto the topic over the years. And I think it's particularly nice how, like, this design has very few special purpose features from these things. They just fall out naturally from the ability to have multiple a verification frame and execution frames.

**Vitalik (01:25:15 - 01:26:29):**
So it satisfies the natural stuff, like, different signature algorithms, including passkey friendliness, now that we also have the SIG P256R1 precompile, it satisfies post-quantum SIGs, it satisfies native multisig. There's this nice synergy with FOCIL, where privacy protocols, and also even transactions paid with Paymasters can be sent through it, and there's a path to make that FOCIL compatible without intermediaries. The post quantum aspect is definitely the aspect of, like, it's the reason why, account abstraction of some form is ultimately indispensable, but the generality of this thing is also very powerful for a whole set of other goals from basically every camp of the account abstraction community as well.

## Eth R&D Discord Context
```
lightclientRole icon, geth - 1/28/26, 10:58 PM
@fjl and I are proposing native account abstraction as the EL headliner for Hegota. We've been working with Vitalik to further generalize the previous native AA proposal EIP-7701 and have come up with the Frame Transaction. More here on the agenda: https://github.com/ethereum/pm/issues/1883#issuecomment-3815340368
EIP: https://eips.ethereum.org/EIPS/eip-8141
```

## Related EIPs
- EIP-2718: Typed Transaction Envelope (required)
- EIP-4844: Shard Blob Transactions (required)
- EIP-7701: Native Account Abstraction (predecessor)
- ERC-4337: Account Abstraction Using Alt Mempool (related)
- EIP-7702: Set EOA account code (related)
- ERC-7562: Account Abstraction Validation Scope Rules (mempool rules)
