// ── Contract Addresses ──────────────────────────────────
export const TRUSTFLOW_ADDRESS = "0x63e6DDE6763C3466C7b45Be880f7eE5dC2ca3E25";
export const USDT_ADDRESS      = "0x9fCF7D13d10dEdF17d0f24C62f0cf4ED462f65b7";

export const NETWORK_CONFIG = {
  chainId: 2151908,
  chainName: "My Custom L2",
  nativeCurrency: {
    name: "AT",
    symbol: "AT",
    decimals: 18,
  },
  rpcUrls: ["http://127.0.0.1:54430"],
};

export const EXPECTED_CHAIN_ID = NETWORK_CONFIG.chainId;
export const EXPECTED_CHAIN_HEX = `0x${NETWORK_CONFIG.chainId.toString(16)}`;
export const NATIVE_TOKEN_SYMBOL = NETWORK_CONFIG.nativeCurrency.symbol;

// ── Escrow State Enums (mirrors Solidity) ───────────────
export const TOKEN_TYPE = { ETH: 0, USDT: 1 };
export const ESCROW_STATUS = { Active: 0, Completed: 1, Disputed: 2, Refunded: 3 };
export const MILESTONE_STATUS = { Pending: 0, Submitted: 1, Approved: 2 };

export const ESCROW_STATUS_LABEL = {
  0: "Active",
  1: "Completed",
  2: "Disputed",
  3: "Refunded",
};

export const MILESTONE_STATUS_LABEL = {
  0: "Pending",
  1: "Submitted",
  2: "Approved",
};

// ── TrustFlow ABI (human-readable) ─────────────────────
export const TRUSTFLOW_ABI = [
  // ── Events
  "event EscrowCreated(uint256 indexed id, address indexed client, address indexed freelancer, address arbiter, uint8 tokenType, uint256 totalAmount, uint256 deadline)",
  "event MilestoneSubmitted(uint256 indexed escrowId, uint256 milestoneIndex)",
  "event MilestoneApproved(uint256 indexed escrowId, uint256 milestoneIndex, uint256 amount)",
  "event DisputeRaised(uint256 indexed escrowId, address raisedBy)",
  "event DisputeResolved(uint256 indexed escrowId, address arbiter, bool freelancerWins, uint256 amount)",
  "event Refunded(uint256 indexed escrowId, address client, uint256 amount)",

  // ── State Variables
  "function escrowCounter() view returns (uint256)",
  "function USDT() view returns (address)",

  // ── Write: Escrow Creation
  "function createEscrowETH(address freelancer, address arbiter, string[] titles, uint256[] amounts, uint256 deadline) payable",
  "function createEscrowUSDT(address freelancer, address arbiter, string[] titles, uint256[] amounts, uint256 deadline)",

  // ── Write: Milestone Flow
  "function submitMilestone(uint256 escrowId, uint256 milestoneIndex)",
  "function approveMilestone(uint256 escrowId, uint256 milestoneIndex)",

  // ── Write: Dispute
  "function raiseDispute(uint256 escrowId)",
  "function resolveDispute(uint256 escrowId, bool freelancerWins)",

  // ── Write: Refund
  "function refund(uint256 escrowId)",

  // ── Read: Escrow Data
  "function getEscrow(uint256 escrowId) view returns (address client, address freelancer, address arbiter, uint8 tokenType, uint256 totalAmount, uint256 amountReleased, uint8 status, uint256 deadline)",
  "function getMilestones(uint256 escrowId) view returns (tuple(string title, uint256 amount, uint8 status)[])",
  "function getClientEscrows(address client) view returns (uint256[])",
  "function getFreelancerEscrows(address freelancer) view returns (uint256[])",
  "function getArbiterEscrows(address arbiter) view returns (uint256[])",
];

// ── MockUSDT ABI ────────────────────────────────────────
export const USDT_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
