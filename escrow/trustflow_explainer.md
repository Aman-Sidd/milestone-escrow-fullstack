# TrustFlow — Deep Technical Explanation

> For hackathon judges, mentors, and your own debugging confidence.

---

## 1. High-Level Overview

### What It Does
TrustFlow is a **decentralized, trustless escrow system** that lets a **client** safely hire a **freelancer** and pay in phases (milestones). Instead of trusting a middleman platform (like Upwork), the funds are locked in a smart contract and released automatically when each phase of work is verified and approved.

### The Real Problem It Solves
| Pain Today | TrustFlow Solution |
|---|---|
| Freelancer not paid after completing work | Funds are locked in contract before work starts |
| Client pays upfront, freelancer disappears | Funds only release per approved milestone |
| Dispute goes to a biased company | A neutral on-chain arbiter resolves it |
| 20% platform fees | 0% fees, fully permissionless |
| No transparency into where money is | Every action is on-chain and auditable |

### The Three Actors

| Actor | Role | Powers |
|---|---|---|
| **Client** | Hires and pays | Creates escrow, approves milestones, raises disputes, claims refund after deadline |
| **Freelancer** | Does the work | Submits milestones for review |
| **Arbiter** | Neutral third party | Resolves disputes — decides who gets the remaining locked funds |

The arbiter is chosen **at creation time** and hardcoded into the escrow. This prevents either party from gaming the selection later.

---

## 2. Architecture Breakdown

### System Structure
```
TrustFlow.sol
  └── inherits: ReentrancyGuard (OpenZeppelin)
  └── uses lib: SafeERC20 (OpenZeppelin)
  └── references: IERC20 (for USDT)

MockUSDT.sol
  └── inherits: ERC20, Ownable (OpenZeppelin)
  └── Purpose: demo token for testing USDT flow
```

There is **no proxy, no upgradeable pattern, no admin**. The contract is fully immutable once deployed — by design. This is a trust-minimized system.

---

### Storage Design

#### Enums — State Machines
```
TokenType:       ETH(0)   | USDT(1)
EscrowStatus:    Active(0) | Completed(1) | Disputed(2) | Refunded(3)
MilestoneStatus: Pending(0)| Submitted(1) | Approved(2)
```
Enums are used instead of raw integers because:
- They make intent explicit and readable
- They prevent assigning invalid states
- They cost the same gas as `uint8` (Solidity packs enum as `uint8` internally)

#### Structs

**`Milestone`** — one unit of work:
```
title   → human-readable label (e.g. "Frontend Build")
amount  → ETH or USDT owed for completing this phase
status  → Pending | Submitted | Approved
```

**`Escrow`** — the full agreement:
```
id             → auto-incremented unique identifier
client         → address who created & funded it
freelancer     → address hired to do the work
arbiter        → address who resolves disputes
tokenType      → ETH or USDT
totalAmount    → sum of all milestone amounts (locked in contract)
amountReleased → running total of what's been paid out so far
status         → Active | Completed | Disputed | Refunded
deadline       → unix timestamp — after this, client can refund
milestones[]   → dynamic array of Milestone structs
```

Why store `amountReleased`? Instead of looping through all milestones to sum approved amounts every time, we keep a **running counter**. This saves gas on reads and makes the completion check `amountReleased == totalAmount` O(1).

#### Mappings

```solidity
mapping(uint256 => Escrow)    _escrows           // escrowId → full data
mapping(address => uint256[]) _clientEscrows     // client → [escrow IDs]
mapping(address => uint256[]) _freelancerEscrows // freelancer → [escrow IDs]
mapping(address => uint256[]) _arbiterEscrows    // arbiter → [escrow IDs]
```

The three role-indexed mappings exist so the frontend can efficiently load "my escrows" for any wallet without scanning the entire chain. They trade a **small extra storage cost at write time** for **O(1) lookup at read time**.

All mappings are `private` — external callers must use the getter functions, giving us control over what data is exposed.

---

### Event Design

```solidity
EscrowCreated(id, client, freelancer, arbiter, tokenType, totalAmount, deadline)
MilestoneSubmitted(escrowId, milestoneIndex)
MilestoneApproved(escrowId, milestoneIndex, amount)
DisputeRaised(escrowId, raisedBy)
DisputeResolved(escrowId, arbiter, freelancerWins, amount)
Refunded(escrowId, client, amount)
```

**Why events matter:**
1. They are **off-chain logs** — much cheaper than storing extra data in contract state
2. The frontend **subscribes** to these events to update the UI in real-time without polling
3. `indexed` parameters (`id`, `client`, `freelancer`) allow blockchain explorers and frontends to **filter efficiently**
4. They create an immutable audit trail — any judge or user can replay the full history of any escrow

---

## 3. Core Workflow (Step-by-Step)

### Full Lifecycle Sequence

```
CLIENT                    CONTRACT                  FREELANCER              ARBITER
  |                           |                          |                     |
  |--- createEscrowETH() ---->|                          |                     |
  |    + sends ETH            |                          |                     |
  |                           |-- stores Escrow          |                     |
  |                           |-- emits EscrowCreated    |                     |
  |                           |                          |                     |
  |                           |<-- submitMilestone(0) ---|                     |
  |                           |-- status = Submitted     |                     |
  |                           |-- emits MilestoneSubmitted                     |
  |                           |                          |                     |
  |--- approveMilestone(0) -->|                          |                     |
  |                           |-- releases 0.05 ETH ---->|                     |
  |                           |-- amountReleased += 0.05 |                     |
  |                           |-- emits MilestoneApproved                      |
  |                           |                          |                     |
  |         [... repeat for milestones 1, 2 ...]        |                     |
  |                           |                          |                     |
  |                           |-- all approved?          |                     |
  |                           |-- status = Completed     |                     |
  |                           |                          |                     |
  |--- raiseDispute() ------->|   OR                     |                     |
  |                           |-- status = Disputed      |                     |
  |                           |                          |                     |
  |                           |<------- resolveDispute(true/false) ------------|
  |                           |-- sends remaining to winner                    |
  |                           |-- status = Refunded      |                     |
  |                           |                          |                     |
  |--- refund() ------------>|   OR (after deadline, Active only)              |
  |                           |-- sends remaining back to client               |
  |                           |-- status = Refunded      |                     |
```

### State Machine Summary

```
         createEscrow
              ↓
           [Active]
          /    |    \
approveLast  raise   deadline
  milestone  Dispute  passed
     ↓         ↓        ↓
[Completed] [Disputed] [Refunded] ← refund()
                ↓
         resolveDispute()
                ↓
           [Refunded]
```

**Terminal states** are `Completed` and `Refunded` — once reached, no more actions possible. `Disputed` is semi-terminal: only the arbiter can move it to `Refunded`.

---

## 4. Function-Level Explanation

### `createEscrowETH(freelancer, arbiter, titles[], amounts[], deadline)`
- **Who calls it:** Client
- **Access control:** Anyone (client is whoever calls it)
- **What it does:** Accepts ETH (`payable`), validates all inputs, and locks the funds in the contract permanently until released
- **Key checks:**
  - `msg.value == total` → prevents accidental over/under-funding. If you send 0.1 ETH but milestones sum to 0.2 ETH, it reverts. No partial funding allowed.
  - `deadline > block.timestamp` → prevents creating an already-expired escrow
  - `msg.sender != freelancer` → you can't hire yourself (prevents trivial theft)
  - `freelancer != arbiter` → prevents a collusive setup where "arbiter" is actually the freelancer

---

### `createEscrowUSDT(freelancer, arbiter, titles[], amounts[], deadline)`
- **Who calls it:** Client (must call `USDT.approve(TrustFlow, total)` first)
- **What it does:** Pulls USDT from the caller via `safeTransferFrom`, then creates the escrow
- **Why `safeTransferFrom`?** The standard ERC-20 `transferFrom` returns `false` on failure instead of reverting. `SafeERC20` wraps it to always revert on failure — critical for security.
- **Key requirement:** Caller must approve the contract before calling this function — this is the standard ERC-20 allowance flow.

---

### `submitMilestone(escrowId, milestoneIndex)`
- **Who calls it:** Freelancer only
- **What it does:** Marks one milestone as "work complete, please review"
- **Key checks:**
  - `status == Active` → can't submit on a frozen/completed escrow
  - `milestones[i].status == Pending` → prevents re-submitting an already-submitted milestone
- **Note:** Milestones must be submitted one at a time. You can submit milestone 2 before milestone 0 is approved — the contract doesn't enforce order. This is intentional flexibility.

---

### `approveMilestone(escrowId, milestoneIndex)`
- **Who calls it:** Client only
- **What it does:** Marks milestone as Approved, updates `amountReleased`, transfers funds to freelancer immediately
- **Completion check:** `if (amountReleased == totalAmount) → status = Completed` — uses exact equality which is safe because all milestone amounts were set at creation and can't change
- **`nonReentrant`:** Critical here because it calls `_transfer` which sends ETH or tokens to an external address. Without this guard, a malicious freelancer contract could re-enter and drain funds.

---

### `raiseDispute(escrowId)`
- **Who calls it:** Client **or** Freelancer (either party)
- **What it does:** Freezes the escrow — no more milestone approvals possible, only arbiter can resolve
- **No `nonReentrant` needed:** No ETH/token movement in this function — it only flips a state variable
- **Design note:** Once disputed, the escrow can only exit via `resolveDispute`. Even the deadline-based `refund` won't work because `refund` calls `_activeEscrow` which requires `status == Active`.

---

### `resolveDispute(escrowId, freelancerWins)`
- **Who calls it:** Arbiter only
- **What it does:** Sends the **remaining** (not yet released) funds to the winner
- **Why remaining, not total?** Some milestones may have been approved and paid out before the dispute was raised. Those are done. The arbiter only arbitrates the **unresolved** portion.
- **`freelancerWins = true`** → freelancer gets remaining funds
- **`freelancerWins = false`** → client gets their money back
- **Uses `_escrows[id]` directly** (not `_activeEscrow`) because escrow status is `Disputed`, not `Active`

---

### `refund(escrowId)`
- **Who calls it:** Client only
- **When:** Only after `deadline` has passed and escrow is still `Active`
- **What it does:** Returns unreleased funds to the client
- **Partial refunds supported:** If milestones 0 and 1 were already approved and paid out, only the remaining balance is refunded — the contract already paid the freelancer for completed work
- **Prevents abuse:** The deadline forces the client to give the freelancer a realistic time window. You can't just immediately refund.

---

### Internal Helper: `_validate(...)`
Centralizes all creation-time input validation. Called by both `createEscrowETH` and `createEscrowUSDT`. Returns the computed total so ETH can be matched without re-looping.

### Internal Helper: `_activeEscrow(escrowId)`
Returns the storage reference to an escrow **only if** it exists and is `Active`. Used by all state-changing functions (except `resolveDispute`) to enforce the state machine in one place.

### Internal Helper: `_transfer(tokenType, to, amount)`
Single dispatch function for sending ETH or USDT. Centralizes transfer logic — if we ever wanted to add a third token, we add it here only.

---

## 5. Security Considerations

### ① Reentrancy
**Risk:** When sending ETH with `.call{value}()`, the recipient could be a malicious contract that calls back into TrustFlow before the state is updated.

**Mitigation:** Two layers of protection:
1. **`nonReentrant` modifier** (from OpenZeppelin's `ReentrancyGuard`) on all fund-moving functions: `createEscrowETH`, `approveMilestone`, `resolveDispute`, `refund`
2. **Checks-Effects-Interactions pattern:** State is updated **before** the transfer happens (milestone status set to `Approved`, `amountReleased` incremented) — so even if re-entered, the checks would fail

---

### ② Access Control
**Risk:** Wrong person calling sensitive functions.

**Mitigation:**
- Every function explicitly checks `msg.sender` against the stored role address
- Roles are immutable — set at creation, never changeable
- Arbiter is assigned by the client at creation (not self-assignable by either party later)

**Remaining risk:** If the client's private key is compromised, an attacker can refuse to approve milestones or raise false disputes.

---

### ③ State Transition Safety
**Risk:** Function called in wrong state (e.g. approving a milestone on a disputed escrow).

**Mitigation:** `_activeEscrow()` is a reusable guard that enforces `status == Active` for all standard operations. The dispute endpoint bypasses this deliberately and checks `status == Disputed` itself.

---

### ④ Integer Overflow
**Risk:** Pre-Solidity 0.8, adding `uint256` values could overflow silently.

**Mitigation:** Solidity 0.8+ has **built-in overflow/underflow protection** — any overflow reverts automatically. No `SafeMath` needed.

---

### ⑤ Front-Running
**Risk:** In a public mempool, an observer might see a `submitMilestone` tx and front-run an `approveMilestone` before the freelancer's tx lands.

**In this contract:** Only the client can approve. The worst case is the client approves a milestone before they intended — but they initiated the tx themselves. True front-running risk is minimal here since the actions require specific roles.

---

### ⑥ Token Safety
**Risk:** Non-compliant ERC-20 tokens that return `false` instead of reverting on failure.

**Mitigation:** `SafeERC20` library wraps all token interactions and reverts on `false` returns or missing return values.

---

## 6. Design Decisions

### Why Milestone-Based Over Simple Buyer-Seller?
A flat buyer-seller escrow is binary: the client pays or doesn't. Real work is iterative. Milestone escrow reflects how contracts actually work — "pay me for phase 1, then phase 2." It's more realistic and impressive to demonstrate.

### Why ETH + USDT (not ETH only)?
- ETH is volatile. A freelancer doing a 2-week project doesn't want to be paid in an asset that could drop 20% during the job.
- USDT provides **stable, USD-pegged payments** — more realistic for real freelance contracts.
- Supporting both shows technical maturity (ERC-20 allowance pattern, `SafeERC20`).

### Why Arbiter Set at Creation?
- Prevents collusion or gaming the arbiter selection during a dispute
- Simulates a real-world trusted mediator chosen before signing a contract
- Both parties must implicitly agree to the arbiter by accepting the escrow terms

### Why No Upgradability?
- Upgradeable contracts (proxies) introduce an admin key — which is a central point of trust/failure
- For a hackathon escrow, immutability **is** the security model: "the code is the contract"
- Keeps the code simpler and auditable

### Why `calldata` for String Arrays?
String arrays passed as `calldata` (instead of `memory`) are **not copied** to memory during the function call — they're read directly from the transaction data. This is cheaper in gas for large inputs.

### Why `private` Mappings + Public Getters?
Exposing `public` mappings for complex types (like structs with nested arrays) doesn't work cleanly in Solidity. Custom view functions let us return exactly what the frontend needs in a controlled format.

---

## 7. Limitations (Honest)

| Limitation | Impact |
|---|---|
| **Arbiter is trusted and centralized** | The arbiter could collude with one party. No DAO governance. |
| **No partial milestone approval** | Can't say "you did 70% of this milestone, here's 70%." It's all-or-nothing per milestone. |
| **No milestone ordering enforcement** | Freelancer can submit milestone 3 before milestone 1. Logically fine but may confuse. |
| **No cancellation by mutual consent** | If both parties agree to cancel mid-way, there's no cooperative exit — must wait for deadline. |
| **USDT is a fixed address** | Contract only supports the USDT address set at deploy time. No multi-token generality. |
| **No on-chain file attachments** | Proof of work (screenshots, code links) is off-chain — nothing verifiable on-chain. |
| **No dispute timeout** | If arbiter disappears after a dispute is raised, funds are locked forever. |
| **Gas costs** | Storing milestone strings in contract storage is gas-expensive on mainnet. |

---

## 8. Post-Hackathon Improvements

### Feature Upgrades
- **Mutual cancellation:** Both parties sign a cancellation → partial refund based on completed milestones
- **Split resolution:** Arbiter can award a percentage split, not just binary winner
- **Milestone ordering enforcement:** Require milestone N-1 to be `Approved` before N can be `Submitted`
- **Multi-token:** Accept any ERC-20 via a whitelist, not just USDT
- **IPFS proof:** Require freelancer to submit an IPFS hash (file/screenshot) as proof with each milestone

### Security Upgrades
- **Arbiter timeout:** If arbiter doesn't resolve within X days, funds auto-split 50/50
- **Multi-sig arbiter:** Require 2-of-3 arbiters to agree (DAO-lite dispute resolution)
- **Pause mechanism:** Emergency pause by owner for critical bug response
- **Formal verification:** Use tools like Certora Prover or Echidna for fuzzing

### UX Improvements
- **ENS name resolution:** Show `alice.eth` instead of `0xABC...`
- **Email/webhook notifications:** Off-chain service listens to events and notifies parties
- **Mobile wallet support:** WalletConnect integration beyond just MetaMask

### Scalability
- **Layer 2 deployment:** Deploy on Polygon, Arbitrum, or Base for cent-level gas fees
- **The Graph integration:** Index contract events for fast dashboard queries instead of RPC calls
- **Subgraph:** Build a GraphQL API over the event logs for rich analytics

---

## 9. How to Explain This to Judges (30–60 Seconds)

> *"We built TrustFlow — a decentralized milestone escrow on Ethereum.*
> 
> *The problem: freelancers get scammed and clients waste money. Centralized platforms take 20% fees and can freeze accounts. Neither party has real protection.*
> 
> *Our solution: a smart contract where the client locks payment upfront, but it releases in phases — only when they verify each milestone is done. If there's a dispute, a pre-agreed arbiter resolves it on-chain.*
> 
> *We support both ETH and USDT for stable payments. The contract has zero platform fees, is fully immutable, and every action emits on-chain events anyone can audit.*
> 
> *Technically: we used Solidity 0.8.28 with OpenZeppelin's ReentrancyGuard and SafeERC20 for security. The state machine design ensures funds can never be in two places at once. We have a full test suite covering happy paths, access control, and edge cases like disputes and post-deadline refunds.*
> 
> *This isn't just a demo — the contract architecture is production-ready for a Layer 2 deployment."*

---

### Quick Cheat Sheet for Q&A

| Judge Question | Your Answer |
|---|---|
| "What stops the client from never approving?" | Deadline-based refund protects the freelancer's time; dispute system is the escalation path |
| "Who is the arbiter?" | Chosen by the client at creation — ideally a trusted mutual contact or a DAO in v2 |
| "What if the arbiter disappears?" | Known limitation — post-hackathon fix is an arbiter timeout with auto-split |
| "Why not use Chainlink for dispute resolution?" | Out of scope for MVP; Chainlink would be a great oracle integration for v2 |
| "Is this audited?" | Not formally — but it uses audited OpenZeppelin primitives and follows known security patterns |
| "Why not Foundry?" | Hardhat was chosen for frontend integration speed and familiarity in a hackathon context |
