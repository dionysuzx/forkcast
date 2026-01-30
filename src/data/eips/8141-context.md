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

#### Constraints

Some validity constraints can be determined statically:

- assert tx.chain_id < 2**256
- assert tx.nonce < 2**64
- assert len(tx.frames) > 0 and len(tx.frames) <= MAX_FRAMES
- assert len(tx.sender) == 20
- assert tx.frames[n].mode < 3
- assert len(tx.frames[n].target) == 20 or tx.frames[n].target is None

### New Opcodes

#### `APPROVE` opcode (`0xaa`)

The `APPROVE` opcode is like `RETURN (0xf3)`. It exits the current context successfully, but with a status code beyond the traditional `0` fail and `1` success via the `scope` operand.

##### Scope Operand

The scope operand must be one of the following values:

1. `0x0`: Approval of execution - the sender contract approves future frames calling on its behalf.
2. `0x1`: Approval of payment - the contract approves paying the total gas cost for the transaction.
3. `0x2`: Approval of execution and payment - combines both `0x0` and `0x1`.

### Behavior

When processing a frame transaction:

1. Verify tx.nonce == state[tx.sender].nonce
2. Initialize payer_approved = false, sender_approved = false
3. Execute each frame with specified mode, target, gas_limit, and data
4. Update approval state based on frame exit status
5. After all frames, verify payer_approved == true and refund unused gas

### Gas Accounting

tx_gas_limit = FRAME_TX_INTRINSIC_COST + calldata_cost(rlp(tx.frames)) + sum(frame.gas_limit for all frames)

Each frame has its own gas_limit allocation. Unused gas from a frame is not available to subsequent frames.

## Rationale

### Canonical signature hash

The canonical signature hash is provided in `TXPARAMLOAD` to simplify the development of smart accounts. Computing the signature hash in EVM is complicated and expensive.

### Payer in receipt

The payer cannot be determined statically from a frame transaction and is relevant to users. The only way to provide this information safely and efficiently over the JSON-RPC is to record this data in the receipt object.

### No authorization list

The EIP-7702 authorization list heavily relies on ECDSA cryptography. While delegations could be used in other manners later, it does not satisfy the PQ goals of the frame transaction.

### No access list

The access list was introduced to address a particular backwards compatibility issue caused by EIP-2929. Future optimizations based on pre-announcing state elements will be covered by block level access lists.

### No value in frame

It is not required because the account code can send value.

## Backwards Compatibility

The `ORIGIN` opcode behavior changes for frame transactions, returning the frame's caller rather than the traditional transaction origin. This is consistent with the precedent set by EIP-7702, which already modified `ORIGIN` semantics.

## Security Considerations

### Transaction Propagation

Frame transactions introduce new denial-of-service vectors for transaction pools. Because validation logic is arbitrary EVM code, attackers can craft transactions that appear valid during initial validation but become invalid later.

#### Mitigations

Node implementations should consider restricting which opcodes and storage slots validation frames can access, similar to ERC-7562. This isolates transactions from each other and limits mass invalidation vectors.
```

## Commit History
Source: https://github.com/ethereum/EIPs/commits/master/EIPS/eip-8141.md
```
{"date":"2026-01-29","message":"Update EIP-8141: Fix status field number","sha":"187d1ce"}
{"date":"2026-01-29","message":"Update EIP-8141: fix typos","sha":"723c9ca"}
{"date":"2026-01-29","message":"Add EIP: Frame Transaction","sha":"6f46a8c"}
```

## Original PR Discussion
Source: https://github.com/ethereum/EIPs/pull/11202

### PR Body
(empty)

### Issue Comments
- eth-bot (2026-01-29): All reviewers have approved.
- github-actions (2026-01-29): The commit 9df7fe661fd9e11d23435ea57f2eb5260dcf7039 contains errors. Please inspect the Run Summary for details.

### Review Comments
- abcoathup: Assigning next sequential EIP/ERC/RIP number. Numbers are assigned by editors & associates.
- abcoathup: Added assigned number to discussions-to URL

### Reviews
- lightclient: APPROVED
- eth-bot: APPROVED - All Reviewers Have Approved; Performing Automatic Merge...

## Eth Magicians Discussion Thread
Source: https://ethereum-magicians.org/t/eip-8141-frame-transaction/27617

### Posts

**matt (2026-01-29T03:35:02.308Z)**
Add a new transaction whose validity and gas payment can be defined abstractly. Instead of relying solely on a single ECDSA signature, accounts may freely define and interpret their signature scheme using any cryptographic system.
[Link to PR #11202]

**thegaram33 (2026-01-29T13:14:25.143Z)**
This looks great!
What happens if there are multiple `VERIFY` frames that return `APPROVE(0x1)` or `APPROVE(0x2)`? Does that invalidate the transaction, or the first/last will pay for gas?

**fjl (2026-01-29T13:36:25.805Z)**
As per Behavior section, if a frame exits with 2, 3, or 4, and the corresponding variable (`sender_approved`, `payer_approved`) is already set to true, the frame reverts. So only the first approval counts. Redundant/conflicting approvals do not invalidate the transaction.

**thegaram33 (2026-01-29T14:00:19.553Z)**
Makes sense. So it is possible that some frames revert, while the rest do not.
Is there a way to implement "atomic multicall" functionality with this then? I.e. given multiple `SENDER` frames, either all of them succeed or all revert?

**fjl (2026-01-29T14:08:25.683Z)**
There is no feature for introspecting the status code of other frames in the transaction. Edit: actually, we do have that, using TXPARAMLOAD (0x15).
You can also check for a revert by inspecting the effects of the frame. But performing multiple SENDER frames is equivalent to a single SENDER frame that batches the calls.
It should not be possible to make the entire transaction invalid after some SENDER frames have already been processed.

**Helkomine (2026-01-29T16:22:44.587Z)**
I think there's no need for multiple call frames at the protocol level, because the atomicity of these frames isn't organized efficiently enough. For comparison, UniversalRouter allows nested call frames of arbitrary depth, as well as the ability to isolate unrelated calls or bind them in various ways. A more reasonable approach would be to have a maximum of 3 call frames.
Why are we willing to complicate the protocol by introducing new transaction formats and a lot of code when a simpler approach would be to periodically add new signature schemes/delete old signature schemes for the authorization_tuple?
I like the TXPARAM* idea because it allows access to nonce.

**shemnon (2026-01-29T16:50:33.745Z)**
Before I dive in completely, is there any reason the DeFi use case wasn't listed in the examples? Frame 0 verify, Frame 1 approve, Frame 2 swap? I wonder if focusing examples on the PQ motivation undersells the immediate use case that the community has been asking to get for years.

**matt (2026-01-29T16:59:49.642Z)**
Mostly because defi use cases can be realized today with several mechanisms: smart accounts, 4337, 7702. There are also endless alternative proposals to achieve what you outlined.
The motivation for 8141 is about solving the protocol's ECDSA problem in accounts. Obviously this has high overlap with AA and UX, and we should keep it in mind, we do primarily want to offer a robust and flexible platform to begin migrating accounts to.

**matt (2026-01-29T18:34:17.380Z)**
It's important to understand the rationale for frames in the first place, which can do a better job expressing the EIP. Frames are required to support introspection by the protocol. It's not about supporting multiple calls at the EVM layer. It's about allowing end users to flexibly define the way their transactions should be handled. The protocol can in turn, use the modes we're introducing to reason about the transaction and safely bound the resources needed to validate and propagate abstract transactions over p2p.
Migrating EOA accounts away from ECDSA entirely requires a new transaction type. Today there are several potential PQ crypto systems that could be used to secure an Ethereum account, but none of them are such clear front runners that we would feel confident enshrining directly into the protocol.

**Helkomine (2026-01-30T05:59:18.139Z)**
The examples you provided, and many others, are entirely achievable using command-oriented architectures like Uniswap's UniversalRouter. If your goal is to reduce reliance on ECDSA, then you don't need to do anything - the new ERCs and signature schemes will address this issue in due course. I prefer more sustainable long-term solutions (reducing opcode cost, adding new signature schemes, lock EOA).

**matt (2026-01-30T13:25:33.353Z)**
To move away from ECDSA, we either 1) need a tx type with a predefined set of whitelisted (PQ) cryptographic algos 2) need to allow smart accounts to originate transactions. Obviously 2) is far more compatible with the Ethereum philosophy of giving users powerful primitives.
The UniversalRouter cannot address this without similar protocol changes, because it is a user-level construct. We don't have any mechanism to allow it to originate a tx, at the protocol. ERC-4337 has attempted to be a user-level implementation of AA, similar to as your propose, but while looking into integration into geth, it always ended up kludgy combining the two layers.

**Helkomine (2026-01-30T16:44:59.902Z)**
Your solution focuses on addressing issues related to the originator, which I believe is a minor issue that we can solve using a minor solution. Because most contracts execute logic based on `msg.sender`, with only a small number performing `tx.origin` checks, code observation, or signature requests, these issues are neatly resolved by a single opcode statement that both disguises `ORIGIN` and eliminates code observation.

**matt (2026-01-30T17:08:18.957Z)**
It's not about the value of `ORIGIN`, it's about origination. It's about sending a transaction. Today to pay the block builder to include a transaction there is only 1 pathway: via EOA. The frame transaction adds a second pathway: via code. To do this, it requires something like `APPROVE` to tell the builder that the gas costs can be deducted from the account.
We have already attempted a simpler proposal than EIP-8141 when we proposed EIP-2938. It was simpler but it failed due to the lack of protocol-level introspection. It was complicated to build a p2p tx pool ruleset around it.
The frame transaction is a direct response to this.

**vbuterin (2026-01-30T13:28:25.693Z)**
4337 already supports full state access via the paymaster mechanism.
A paymaster also serves as a de-facto custom mempool acceptance rule, and the protocol acts as a sort of "meta-mempool-acceptance-rule" where anyone can stake ETH to add their mempool acceptance rule to the list.
Since 8141 is a modification on 7701, and 7701 is itself an onchain version of 4337, this design can be applied as-is to make a mempool for 8141 transactions.

## Headliner Proposal
Source: https://ethereum-magicians.org/t/hegota-headliner-proposal-frame-transaction/27618

### Posts

**matt (2026-01-29T03:49:14.172Z)**
Frame Transaction EIP: PR #11202

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
|-------------|-----------|
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
|--------|-----------|
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

1. Paymaster support: paymasters are established under ERC-4337. While this EIP aims to be compatible with them via same mempool rules, it is open question to see that materialize.

**oxshaman (2026-01-29T21:31:55.410Z)**
Great read!
One question - does this imply that the plan is to continue down the path of 4337-Bundler-Style restrictions to state access. As I see the DoS mitigation is approached via ERC-7562 and `MAX_VALIDATION_GAS`.
Is full state access being considered anymore or is it out of scope?

**matt (2026-01-29T21:49:51.459Z)**
I would say it's important to make the distinction between what does the protocol allow and what is allowed in public transaction pool. Our aim is to make the protocol maximally flexible, but start small and carefully expand what the public tx pool will allow.
Concretely to your question: full state access before the payer is approved in this proposal, however, you will need to find a builder who will include such a transaction. Our goal is to support self-sponsored transactions in the beginning and over time allow sponsor transactions (or other variants that gain popularity).

**vbuterin (2026-01-30T13:28:25.693Z)**
4337 already supports full state access via the paymaster mechanism.
A paymaster also serves as a de-facto custom mempool acceptance rule, and the protocol acts as a sort of "meta-mempool-acceptance-rule" where anyone can stake ETH to add their mempool acceptance rule to the list, and if too many transactions pass that rule but do not get included onchain, then it gets throttled and then delisted (as a subjective decision by mempool nodes).
Since 8141 is a modification on 7701, and 7701 is itself an onchain version of 4337, this design can be applied as-is to make a mempool for 8141 transactions.

## Call Transcript
Source: acde/229 - /Users/lucy/bonzai/forkcast/public/artifacts/acde/2026-01-29_229/transcript_corrected.vtt

### Relevant Excerpts

**01:10:59 - Ansgar Dietrichs**
And keep the discussion alive. For today, I would then move on to the second presentation, because... so we can get through all three. So thank you, Yannick. And then next up will be, frame transactions, proposed by Matt and Felix, or I think those two wanted to give a presentation.

**01:11:06 - Felix (Geth)**
I can give the presentation. I mean, there isn't really too much to present, per se. We didn't make the slides, so we... but I can still... I mean, we can look at the EIP together, and I can quickly give an overview by just showing the parts of it.

**01:11:20 - Felix (Geth)**
So, this EIP is a proposal that is in the line of proposals for account abstraction. And, specifically, it has... For us, it's mostly about abstracting the transaction signature away to a system where the user account itself verifies the validity of the transaction, and more specifically, the account itself verifies whether the transaction was sent by itself.

**01:11:51 - Felix (Geth)**
And, there are other goals for account abstraction, and this transaction type also can do those, but for us, it's, like, the primary purpose is this, like, key management topic.

**01:12:13 - Felix (Geth)**
there is a lot of existing... there were a lot of previous EIPs regarded, related to account abstraction, one of them being the EIP7701. this is, in some ways, an evolution of the EIP7701, and it... the... also, the ideas in this EIP, 8141, were co-developed with... together with the team behind EIP7701, so it's kind of like, this is basically, like, the combination of all the ideas that various teams had.

**01:13:00 - Felix (Geth)**
so we feel like this is... we feel pretty good about this proposal, because a lot of these ideas that were previously already tested in ERC437 and during the EIP7701 development and so on, so there's, like, a lot, a lot, a lot of research behind it. That said, there's also some new stuff, and then one of the new things is this frame list.

**01:13:21 - Felix (Geth)**
basically adds a list of multiple calls to the transaction, and then the calls run at different permission levels. We have three modes of execution, we call it here, but they... you can think of them as, like, both a permission level, but also basically configuring the EVM environment a bit differently for each mode.

**01:15:17 - Felix (Geth)**
And, the fee payment is also decoupled from the sender, which is another goal of account abstraction, and it's also a goal that is specifically for the smart accounts and the wallets to be able to sponsor the transactions of their users.

**01:16:58 - Felix (Geth)**
Yeah, there's a lot more things to say about the EAP, but these are more like the detailed things. I just want to highlight that at the end of the EAP, we have a list of examples that kind of show the frame structure for common use cases that people have associated with account abstraction.

**01:17:51 - Felix (Geth)**
if you would use ECDSA signatures, like now, the overall size of the transaction is only, like, 30 bytes more, or something, or 20-something bytes more. So, we feel pretty comfortable with this design, and we propose it as the headliner, because we feel that It's a big change to the state transition.

**01:18:15 - Felix (Geth)**
And it's also kind of, for us, the most important one, because of the readiness for the post-quantum world, and I mean, we kind of feel like we have to get started with the off-ramp from ECDSA, and in order to do that, we need a comprehensive system that can deal with Whatever signature algorithms we want to use.

**01:19:03 - Daniel Lehrner (Besu)**
Yeah, so my... my concerns about this are not so much technical, but we have seen with 7702 that the option for the smart wallets, or for any changes in how we do transaction signing is very, very low. So I think I checked before in one of these dashboards, and we only have, like, 5,000 Transaction... 7702 transactions per day. I'm a bit worried that we would do this as a headliner, as a preparation for post-quantum, but afterwards it's not really used.

**01:20:03 - Felix (Geth)**
for me, it's quite clear that, like, account abstraction has been one of these projects that has been ongoing for many years that people always wanted to realize, and we also see that the existing mechanisms that were proposed for in this direction, they are not adequate to capture what users really want to do.

**01:21:06 - Daniel Lehrner (Besu)**
Yeah, I think it would just be, maybe, important, you know, to talk with wallets and so, because one, I think, issues with 7702 is that, that Rabby, for example, is not supporting it yet.

**01:22:08 - Felix (Geth)**
we feel like we just have to provide the means first, and then we have to work with everyone to build out their infrastructure, because there's almost no incentive to build another infrastructure for keys when the protocol doesn't support it and doesn't look like it will ever support it.

**01:22:37 - Felix (Geth)**
So, Frangio asked the question, how does it look in the mempool? And for this, I want to highlight that, this proposal has a section in the bottom that goes a bit into detail about this. We intend to expand this a lot more. The key thing to note is that while the inside of a block an arbitrary interaction can take place. For example, you could have transactions that do not contain a signature verifying frame. In some cases. This can actually be fine, but for the purposes of the mempool, we will validate the transaction to conform to a specific known frame structure.

**01:24:30 - vitalik**
Yeah, I think I also just wanted to add that, like, from a, use cases perspective, this, does, like, basically satisfy, everything that, at least I've been pushing for, like, the, entire list of, of goals of, account abstraction, including, you know, the original ones, and including various things that have been, bolted onto the topic over the years. And, and I think it's particularly nice how, like, this design has very few special purpose features from these things. They just, fall out naturally from the, ability to have multiple a verification frame and execution frames.

**01:25:15 - vitalik**
the natural stuff, like, different signature algorithms, including, passkey friendliness, now that we also have the, SIG P256R1 precompile, it, satisfies post-quantum SIGs, it satisfies native multisig, it also, I think also worth highlighting, there's this nice synergy with, FOCIL, where, privacy protocols, and, also even, transactions paid with, Paymasters can be, sent through it.

**01:26:07 - vitalik**
aspect of, like, it's the reason why, account abstraction of some form is, ultimately indispensable, but, like, the generality of this, thing is also very powerful for a whole set of, other goals from, like, basically every, camp of the account abstraction community as well.

## Eth R&D Discord Context
Source: Eth R&D Discord (user-provided)

lightclient — 1/28/26, 10:58 PM
@fjl and I are proposing native account abstraction as the EL headliner for Hegota. We've been working with Vitalik to further generalize the previous native AA proposal EIP-7701 and have come up with the Frame Transaction. More here on the agenda: https://github.com/ethereum/pm/issues/1883#issuecomment-3815340368
EIP: https://eips.ethereum.org/EIPS/eip-8141

## Related EIPs
- EIP-2718: Typed Transaction Envelope (required)
- EIP-4844: Shard Blob Transactions (required)
- EIP-7701: Previous native AA proposal that EIP-8141 evolves from
- EIP-7702: Set Code for EOAs (related, already changed ORIGIN semantics)
- ERC-4337: Account Abstraction Using Alt Mempool (related, user-level implementation)
- ERC-7562: Mempool rules for validation restrictions
