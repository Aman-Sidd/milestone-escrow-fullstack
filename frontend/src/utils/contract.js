import { ethers } from "ethers";
import {
  NETWORK_CONFIG,
  TRUSTFLOW_ADDRESS,
  USDT_ADDRESS,
  TRUSTFLOW_ABI,
  USDT_ABI,
} from "../config";

// ── Provider / Signer ───────────────────────────────────

/** Returns a read-only provider (no signer needed). */
export function getProvider() {
  return new ethers.JsonRpcProvider(NETWORK_CONFIG.rpcUrls[0], {
    chainId: NETWORK_CONFIG.chainId,
    name: NETWORK_CONFIG.chainName,
  });
}

/** Returns a signer for the connected account. */
export async function getSigner() {
  if (!window.ethereum) {
    throw new Error("MetaMask not found");
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  return provider.getSigner();
}

// ── Contract Instances ──────────────────────────────────

/**
 * TrustFlow contract connected to a signer (write) or provider (read).
 * Pass `readOnly = true` to skip wallet interaction (e.g. for fetching data).
 */
export async function getTrustFlow(readOnly = false) {
  if (readOnly) {
    const provider = getProvider();
    return new ethers.Contract(TRUSTFLOW_ADDRESS, TRUSTFLOW_ABI, provider);
  }
  const signer = await getSigner();
  return new ethers.Contract(TRUSTFLOW_ADDRESS, TRUSTFLOW_ABI, signer);
}

/**
 * MockUSDT contract connected to a signer.
 */
export async function getUSDT(readOnly = false) {
  if (readOnly) {
    const provider = getProvider();
    return new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
  }
  const signer = await getSigner();
  return new ethers.Contract(USDT_ADDRESS, USDT_ABI, signer);
}

// ── Formatting Helpers ──────────────────────────────────

/** Wei → ETH string (4 decimal places) */
export function formatETH(wei) {
  return parseFloat(ethers.formatEther(wei)).toFixed(4);
}

/** Raw USDT (6 decimals) → human string */
export function formatUSDT(raw) {
  return parseFloat(ethers.formatUnits(raw, 6)).toFixed(2);
}

/** Format amount by token type: 0 = ETH, 1 = USDT */
export function formatAmount(raw, tokenType) {
  if (Number(tokenType) === 0) return `${formatETH(raw)} ETH`;
  return `${formatUSDT(raw)} USDT`;
}

/** Shorten an address: 0xABCD...1234 */
export function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Unix timestamp → human date string */
export function formatDeadline(ts) {
  return new Date(Number(ts) * 1000).toLocaleString();
}

/** Returns true if the deadline has passed. */
export function isDeadlinePassed(ts) {
  return Date.now() > Number(ts) * 1000;
}

/** Progress percentage from amountReleased / totalAmount */
export function calcProgress(released, total) {
  if (BigInt(total) === 0n) return 0;
  return Math.round((Number(released) * 100) / Number(total));
}

// ── USDT Approval Helper ────────────────────────────────

/**
 * Ensures the TrustFlow contract has enough USDT allowance.
 * Calls approve() if current allowance is insufficient.
 */
export async function ensureUSDTAllowance(account, amountInUnits) {
  const usdt = await getUSDT();
  const allowance = await usdt.allowance(account, TRUSTFLOW_ADDRESS);
  if (BigInt(allowance) < BigInt(amountInUnits)) {
    const tx = await usdt.approve(TRUSTFLOW_ADDRESS, amountInUnits);
    await tx.wait();
  }
}

// ── Transaction Helper ──────────────────────────────────

/**
 * Wraps a contract call with unified error handling.
 * Returns { success, txHash, error }.
 */
export async function sendTx(contractCallFn) {
  try {
    const tx = await contractCallFn();
    const receipt = await tx.wait();
    return { success: true, txHash: receipt.hash };
  } catch (err) {
    // Extract revert reason if present
    const reason =
      err?.reason ||
      err?.data?.message ||
      err?.shortMessage ||
      err?.message ||
      "Transaction failed";
    return { success: false, error: reason };
  }
}

// ── Data Fetching ───────────────────────────────────────

/**
 * Fetches complete escrow data + milestones for a given ID.
 * Returns a plain JS object (all BigInts converted to strings for safety).
 */
export async function fetchEscrow(escrowId) {
  const tf = await getTrustFlow(true);
  const [
    client, freelancer, arbiter,
    tokenType, totalAmount, amountReleased,
    status, deadline,
  ] = await tf.getEscrow(escrowId);

  const milestones = await tf.getMilestones(escrowId);

  return {
    id: Number(escrowId),
    client,
    freelancer,
    arbiter,
    tokenType: Number(tokenType),
    totalAmount: totalAmount.toString(),
    amountReleased: amountReleased.toString(),
    status: Number(status),
    deadline: deadline.toString(),
    milestones: milestones.map((m, i) => ({
      index: i,
      title: m.title,
      amount: m.amount.toString(),
      status: Number(m.status),
    })),
  };
}

/**
 * Fetches all escrow IDs for a given role + account,
 * then fetches full data for each. Returns array of escrow objects.
 */
export async function fetchEscrowsForRole(account, role) {
  const tf = await getTrustFlow(true);

  let ids = [];
  if (role === "client")     ids = await tf.getClientEscrows(account);
  if (role === "freelancer") ids = await tf.getFreelancerEscrows(account);
  if (role === "arbiter")    ids = await tf.getArbiterEscrows(account);

  const results = await Promise.all(ids.map((id) => fetchEscrow(id)));
  return results;
}

/**
 * Subscribes to TrustFlow events and calls `onChange` whenever relevant data changes.
 * Returns an unsubscribe function.
 */
export async function subscribeToTrustFlowEvents(onChange) {
  const contract = await getTrustFlow(true);

  const handler = () => {
    onChange();
  };

  const eventNames = [
    "EscrowCreated",
    "MilestoneSubmitted",
    "MilestoneApproved",
    "DisputeRaised",
    "DisputeResolved",
    "Refunded",
  ];

  eventNames.forEach((eventName) => {
    contract.on(eventName, handler);
  });

  return () => {
    eventNames.forEach((eventName) => {
      contract.off(eventName, handler);
    });
  };
}
