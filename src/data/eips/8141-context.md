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

A new [EIP-2718](./eip-2718) transaction with type `FRAME_TX_TYPE` is introduced. Transactions of this type are referred to as "Frame transactions".

The payload is defined as the RLP serialization of the following:

[chain_id, nonce, sender, frames, max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas, blob_versioned_hashes]

frames = [[mode, target, gas_limit, data], ...]

#### Modes

There are three modes:

| Mode | Name           | Summary                                                   |
| ---- | -------------- | --------------------------------------------------------- |
|    0 | `DEFAULT`      | Execute frame as `ENTRY_POINT`                            |
|    1 | `VERIFY`       | Frame identifies as transaction validation                |
|    2 | `SENDER`       | Execute frame as `sender`                                 |

### New Opcodes

#### `APPROVE` opcode (`0xaa`)

The `APPROVE` opcode is like `RETURN (0xf3)`. It exits the current context successfully, but with a status code beyond the traditional `0` fail and `1` success via the `scope` operand.

#### `TXPARAM*` opcodes

The `TXPARAMLOAD` (`0xb0`), `TXPARAMSIZE` (`0xb1`), and `TXPARAMCOPY` (`0xb2`) opcodes follow the pattern of `CALLDATA*` / `RETURNDATA*` opcode families for accessing transaction parameters.
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

### PR Body
Author: Felix Lange (@fjl)
Created: 2026-01-29T03:20:59Z
Title: Add EIP: Frame Transaction

(No body text provided)

### Issue Comments
- eth-bot (2026-01-29): "All reviewers have approved."
- github-actions (2026-01-29): Build status notification

### Review Comments
- abcoathup (2026-01-29): Assigned EIP number 8141, requested filename update
- abcoathup (2026-01-29): Updated discussions-to URL with assigned number

### Reviews
- lightclient: APPROVED
- eth-bot: APPROVED ("All Reviewers Have Approved; Performing Automatic Merge...")

## Eth Magicians Discussion Thread
Source: https://ethereum-magicians.org/t/frame-transaction/27617

(No posts at time of generation - thread recently created)

## Headliner Proposal
Source: https://ethereum-magicians.org/t/hegota-headliner-proposal-frame-transaction/27618

### Metadata
- Title: Hegota Headliner Proposal: Frame Transaction
- Posts: 4
- Created: 2026-01-29T03:49:14Z

### Posts

**matt (2026-01-29T03:49:14Z)**
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
- Quantum threat requires proactive migration (10+ year timeline, but migration is slow)
- ERC-4337 validated demand and design patterns. Time to enshrine.
- EIP-7702 already changed ORIGIN semantics, reducing this proposal's disruption.

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
| Node DoS vectors from arbitrary validation | ERC-7562-style opcode restrictions; MAX_VALIDATION_GAS |
| ORIGIN behavior change | Already precedented by EIP-7702; pattern was discouraged |

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

**oxshaman (2026-01-29T21:31:55Z)**
Great read!

One question - does this imply that the plan is to continue down the path of 4337-Bundler-Style restrictions to state access. As I see the DoS mitigation is approached via ERC-7562 and MAX_VALIDATION_GAS.

Is full state access being considered anymore or is it out of scope?

---

**matt (2026-01-29T21:49:51Z)**
Thank you!

I would say it's important to make the distinction between *what does the protocol allow* and *what is allowed in public transaction pool*. Our aim is to make the protocol maximally flexible, but start small and carefully expand what the public tx pool will allow.

Concretely to your question: full state access before the payer is approved in this proposal, however, you will need to find a builder who will include such a transaction. Our goal is to support self-sponsored transactions in the beginning and over time allow sponsor transactions (or other variants that gain popularity).

---

**vbuterin (2026-01-30T13:28:25Z)**
4337 already supports full state access via the paymaster mechanism.

A paymaster also serves as a de-facto custom mempool acceptance rule, and the protocol acts as a sort of "meta-mempool-acceptance-rule" where anyone can stake ETH to add their mempool acceptance rule to the list, and if too many transactions pass that rule but do not get included onchain, then it gets throttled and then delisted (as a subjective decision by mempool nodes).

Since 8141 is a modification on 7701, and 7701 is itself an onchain version of 4337, this design can be applied as-is to make a mempool for 8141 transactions.

## Call Transcript
Source: ACDE#229 - public/artifacts/acde/2026-01-29_229/transcript_corrected.vtt

### Relevant Excerpts

**01:10:43 - Ansgar Dietrichs (moderator)**
And keep the discussion alive. For today, I would then move on to the second presentation, because... so we can get through all three. So thank you, Yannick. And then next up will be, frame transactions, proposed by Matt and Felix, or I think those two wanted to give a presentation.

**01:11:06 - Felix (Geth)**
I can give the presentation. I mean, there isn't really too much to present, per se. We didn't make the slides, so we... but I can still... I mean, we can look at the EIP together, and I can quickly give an overview by just showing the parts of it.

So, this EIP is a proposal that is in the line of proposals for account abstraction. And, specifically, it has... For us, it's mostly about abstracting the transaction signature away to a system where the user account itself verifies the validity of the transaction, and more specifically, the account itself verifies whether the transaction was sent by itself.

**01:12:22 - Felix (Geth)**
This is, in some ways, an evolution of the EIP7701, and it... the... also, the ideas in this EIP, 8141, were co-developed with... together with the team behind EIP7701, so it's kind of like, this is basically, like, the combination of all the ideas that various teams had.

So we feel like this is... we feel pretty good about this proposal, because a lot of these ideas that were previously already tested in ERC437 and during the EIP7701 development and so on, so there's, like, a lot, a lot, a lot of research behind it.

**01:13:00 - Felix (Geth)**
That said, there's also some new stuff, and then one of the new things is this frame list. So basically this, transaction type allows... basically adds a list of multiple calls to the transaction, and then the calls run at different permission levels. We have three modes of execution, we call it here, but they... you can think of them as, like, both a permission level, but also basically configuring the EVM environment a bit differently for each mode.

**01:14:06 - Felix (Geth)**
Adding the frames has some implications. So, for example, also in the receipt, we have per frame receipts, which is useful, among other things, for native batching, so it kind of has this, like... basically, it adds another layer of calls into the main loop of executing Ethereum.

**01:15:08 - Felix (Geth)**
Rule gives... is designed in such a way to make sure that before anything is executed as the sender of the transaction, the transaction first has to confirm that the transaction is authentic, and in another step, or in the same step, it has to confirm that the fees for the transaction were paid.

And, the fee payment is also decoupled from the sender, which is another goal of account abstraction, and it's also a goal that is specifically for the smart accounts and the wallets to be able to sponsor the transactions of their users.

**01:16:13 - Felix (Geth)**
The main one we have is... the one that actually changes the semantics the most is the approve opcode, which is basically another way to return. So this is, like, this is an opcode that terminates execution, and unlike return, it terminates it with a status code that is beyond the usual 0 and 1 status. So at the moment, returning from an EVM call has a success or failure state, and with this new opcode, there are 3 more states that a call can end in, and so this is, like, a change in EVM semantics.

**01:18:11 - Felix (Geth)**
If you would use ECDSA signatures, like now, the overall size of the transaction is only, like, 30 bytes more, or something, or 20-something bytes more. So, we feel pretty comfortable with this design, and we are happy to defend it, and we propose it as the headliner, because we feel that it's a big change to the state transition.

And it's also kind of, for us, the most important one, because of the readiness for the post-quantum world, and I mean, we kind of feel like we have to get started with the off-ramp from ECDSA, and in order to do that, we need a comprehensive system that can deal with whatever signature algorithms we want to use.

**01:19:03 - Daniel Lehrner (Besu)**
Yeah, so my... my concerns about this are not so much technical, but we have seen with 7702 that the option for the smart wallets, or for any changes in how we do transaction signing is very, very low. So I think I checked before in one of these dashboards, and we only have, like, 5,000 Transaction... 7702 transactions per day.

I'm a bit worried that we would do this as a headliner, as a preparation for post-quantum, but afterwards it's not really used.

**01:20:03 - Felix (Geth)**
Yeah, there's not much I can say about these concerns. This is, not, since it's not a technical concern. For me, it's quite clear that, like, account abstraction has been one of these projects that has been ongoing for many years that people always wanted to realize, and we also see that the existing mechanisms that were proposed for in this direction, they are not adequate to capture what users really want to do.

**01:21:06 - Daniel Lehrner (Besu)**
Yeah, I think it would just be, maybe, important, you know, to talk with wallets and so, because one, I think, issues with 7702 is that, that Rabby, for example, is not supporting it yet.

**01:22:10 - Felix (Geth)**
So, Frangio asked the question, how does it look in the mempool? And for this, I want to highlight that, this proposal has a section in the bottom that goes a bit into detail about this. We expand... we intend to expand this a lot more.

The key thing to note is that while the inside of a block an arbitrary interaction can take place. For example, you could have transactions that do not contain a signature verifying frame. In some cases. This can actually be fine, but for the purposes of the mempool, we will validate the transaction to conform to a specific known frame structure, and this includes having a gas limit on the signature verification.

**01:23:33 - Felix (Geth)**
For a specific application, custom mempools can be built that validate the transaction according to more specific rules, whereas if you just want to make a general verification of transactions, you have to really limit what the transaction can do inside of its verification phase. But once these limits are applied, one key thing to realize is that using the EVM to verify the signature isn't different from calling the ECDSA verification in the native code, it's just a different way, it's just a different signature algorithm in the end.

**01:24:30 - vitalik**
Yeah, I think I also just wanted to add that, like, from a, use cases perspective, this, does, like, basically satisfy, everything that, at least I've been pushing for, like, the, entire list of, of goals of account abstraction, including, you know, the original ones, and including various things that have been, bolted onto the topic over the years.

And, and I think it's particularly nice how, like, this design has very few special purpose features from these things. They just, fall out naturally from the, ability to have multiple a verification frame and execution frames, so it satisfies, the natural stuff, like, different signature algorithms, including, passkey friendliness, now that we also have the, SIG P256R1 precompile, it, satisfies post-quantum SIGs, it satisfies native multisig.

I think also worth highlighting, there's this nice synergy with, FOCIL, where, privacy protocols, and, also even, transactions paid with, Paymasters can be, sent through it, and, there's a path, to make that FOCIL compatible without inter... without intermediaries, and so there's, a benefit in terms of censorship resistance for privacy.

So I think, yeah, like, the post, quantum aspect is, definitely the aspect of, like, it's the reason why, account abstraction of some form is, ultimately indispensable, but, like, the generality of this, thing is also very powerful for a whole set of, other goals from, like, basically every, camp of the account abstraction community as well.

## Eth R&D Discord Context
Source: Eth R&D Discord (user-provided)

lightclient (2026-01-28):
> @fjl and I are proposing native account abstraction as the EL headliner for Hegota. We've been working with Vitalik to further generalize the previous native AA proposal EIP-7701 and have come up with the Frame Transaction. More here on the agenda: https://github.com/ethereum/pm/issues/1883#issuecomment-3815340368
> EIP: https://eips.ethereum.org/EIPS/eip-8141

## Related EIPs

### EIP-2718 (Required)
Typed Transaction Envelope - defines the envelope format for typed transactions that EIP-8141 uses.

### EIP-4844 (Required)
Shard Blob Transactions - EIP-8141 supports blob transactions within the frame transaction structure.

### EIP-7701 (Related)
Native Account Abstraction - previous proposal that EIP-8141 evolves from, co-developed with the 7701 team.

### EIP-7702 (Related)
Set Code for EOAs - mentioned as complementary but solving different problem, not PQ secure.

### ERC-4337 (Related)
Account Abstraction Using Alt Mempool - existing AA solution that validated demand and patterns, EIP-8141 provides native enshrining path.

### ERC-7562 (Related)
Account Abstraction Validation Scope Rules - provides mempool validation rules that EIP-8141 leverages for DoS mitigation.
