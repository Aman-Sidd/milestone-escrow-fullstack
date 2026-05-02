import React, { useCallback, useState } from "react";
import { ethers } from "ethers";
import { ensureUSDTAllowance, getTrustFlow, sendTx } from "../utils/contract";

const DEFAULT_MILESTONE = { title: "", amount: "" };
const DEFAULT_FORM = {
  freelancer: "",
  arbiter: "",
  tokenType: "ETH",
  deadline: "",
  milestones: [
    { title: "Wireframes and design", amount: "" },
    { title: "Development", amount: "" },
    { title: "Final delivery", amount: "" },
  ],
};

function calcTotal(milestones) {
  return milestones.reduce((sum, milestone) => {
    const value = Number.parseFloat(milestone.amount);
    return sum + (Number.isNaN(value) ? 0 : value);
  }, 0);
}

function isValidAddress(address) {
  try {
    ethers.getAddress(address);
    return true;
  } catch {
    return false;
  }
}

function toLocalDateTimeInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function CreateEscrow({ account }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [status, setStatus] = useState(null);
  const [txHash, setTxHash] = useState("");

  const updateMilestone = (index, field, value) => {
    if (status?.type !== "loading") {
      setStatus(null);
    }
    setForm((current) => {
      const nextMilestones = [...current.milestones];
      nextMilestones[index] = { ...nextMilestones[index], [field]: value };
      return { ...current, milestones: nextMilestones };
    });
  };

  const addMilestone = () => {
    setForm((current) => {
      if (current.milestones.length >= 10) {
        return current;
      }

      return {
        ...current,
        milestones: [...current.milestones, { ...DEFAULT_MILESTONE }],
      };
    });
  };

  const removeMilestone = (index) => {
    setForm((current) => {
      if (current.milestones.length <= 1) {
        return current;
      }

      return {
        ...current,
        milestones: current.milestones.filter((_, milestoneIndex) => milestoneIndex !== index),
      };
    });
  };

  const validate = useCallback(() => {
    if (!isValidAddress(form.freelancer)) {
      return "Enter a valid freelancer wallet address.";
    }

    if (!isValidAddress(form.arbiter)) {
      return "Enter a valid arbiter wallet address.";
    }

    if (form.freelancer.toLowerCase() === account.toLowerCase()) {
      return "Client and freelancer cannot be the same address.";
    }

    if (form.freelancer.toLowerCase() === form.arbiter.toLowerCase()) {
      return "Freelancer and arbiter cannot be the same address.";
    }

    if (!form.deadline) {
      return "Choose a deadline for the escrow.";
    }

    const deadlineTimestamp = Math.floor(new Date(form.deadline).getTime() / 1000);
    if (deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
      return "Deadline must be in the future.";
    }

    for (let index = 0; index < form.milestones.length; index += 1) {
      const milestone = form.milestones[index];

      if (!milestone.title.trim()) {
        return `Milestone ${index + 1} needs a title.`;
      }

      if (!milestone.amount || Number.parseFloat(milestone.amount) <= 0) {
        return `Milestone ${index + 1} needs an amount greater than zero.`;
      }
    }

    return "";
  }, [account, form]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTxHash("");

    const validationError = validate();
    if (validationError) {
      setStatus({ type: "error", msg: validationError });
      return;
    }

    const titles = form.milestones.map((milestone) => milestone.title.trim());
    const deadlineTimestamp = BigInt(Math.floor(new Date(form.deadline).getTime() / 1000));

    try {
      if (form.tokenType === "ETH") {
        setStatus({ type: "loading", msg: "Confirm the ETH escrow transaction in MetaMask." });

        const amounts = form.milestones.map((milestone) =>
          ethers.parseEther(milestone.amount.toString())
        );
        const totalWei = amounts.reduce((sum, amount) => sum + amount, 0n);

        const trustFlow = await getTrustFlow();
        const result = await sendTx(() =>
          trustFlow.createEscrowETH(form.freelancer, form.arbiter, titles, amounts, deadlineTimestamp, {
            value: totalWei,
          })
        );

        if (!result.success) {
          setStatus({ type: "error", msg: result.error });
          return;
        }

        setTxHash(result.txHash);
        setStatus({ type: "success", msg: "Escrow created successfully with ETH." });
        setForm(DEFAULT_FORM);
        return;
      }

      setStatus({ type: "loading", msg: "Step 1 of 2: approve MockUSDT in MetaMask." });

      const amounts = form.milestones.map((milestone) =>
        ethers.parseUnits(milestone.amount.toString(), 6)
      );
      const totalUnits = amounts.reduce((sum, amount) => sum + amount, 0n);

      await ensureUSDTAllowance(account, totalUnits);

      setStatus({ type: "loading", msg: "Step 2 of 2: create the MockUSDT escrow." });

      const trustFlow = await getTrustFlow();
      const result = await sendTx(() =>
        trustFlow.createEscrowUSDT(form.freelancer, form.arbiter, titles, amounts, deadlineTimestamp)
      );

      if (!result.success) {
        setStatus({ type: "error", msg: result.error });
        return;
      }

      setTxHash(result.txHash);
      setStatus({ type: "success", msg: "Escrow created successfully with MockUSDT." });
      setForm(DEFAULT_FORM);
    } catch (error) {
      setStatus({
        type: "error",
        msg: error?.shortMessage || error?.message || "Unexpected error while creating escrow.",
      });
    }
  };

  const total = calcTotal(form.milestones);
  const isLoading = status?.type === "loading";
  const minDeadline = toLocalDateTimeInput(new Date(Date.now() + 60_000));

  return (
    <div className="create-escrow">
      <div className="panel-header">
        <h2>Create Escrow</h2>
        <span className="status-pill status-pill--ok">Wallet Ready</span>
      </div>

      <div className="message-box message-box--success">
        Connected client wallet: <strong>{account}</strong>
      </div>

      <div className="message-box message-box--loading">
        Demo tip: use different MetaMask accounts for client, freelancer, and arbiter so you can
        walk the full flow live.
      </div>

      <form className="create-form" onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label className="form-label">Payment token</label>
          <div className="token-toggle">
            {["ETH", "USDT"].map((token) => (
              <button
                key={token}
                type="button"
                className={`token-button ${form.tokenType === token ? "token-button--active" : ""}`}
                onClick={() => setForm((current) => ({ ...current, tokenType: token }))}
                disabled={isLoading}
              >
                {token === "ETH" ? "ETH escrow" : "MockUSDT escrow"}
              </button>
            ))}
          </div>
          {form.tokenType === "USDT" && (
            <p className="form-hint">
              MockUSDT requires two confirmations: approval first, escrow creation second.
            </p>
          )}
        </div>

        <div className="form-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="freelancer-address">
              Freelancer address
            </label>
            <input
              id="freelancer-address"
              className="form-input"
              placeholder="0x..."
              value={form.freelancer}
              onChange={(event) =>
                setForm((current) => ({ ...current, freelancer: event.target.value }))
              }
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="arbiter-address">
              Arbiter address
            </label>
            <input
              id="arbiter-address"
              className="form-input"
              placeholder="0x..."
              value={form.arbiter}
              onChange={(event) =>
                setForm((current) => ({ ...current, arbiter: event.target.value }))
              }
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="deadline">
            Deadline
          </label>
          <input
            id="deadline"
            type="datetime-local"
            className="form-input"
            min={minDeadline}
            value={form.deadline}
            onChange={(event) =>
              setForm((current) => ({ ...current, deadline: event.target.value }))
            }
            disabled={isLoading}
          />
        </div>

        <div className="form-group">
          <div className="milestones-header">
            <label className="form-label">Milestones ({form.milestones.length}/10)</label>
            <button
              type="button"
              className="secondary-button"
              onClick={addMilestone}
              disabled={isLoading || form.milestones.length >= 10}
            >
              Add milestone
            </button>
          </div>

          <div className="milestones-list">
            {form.milestones.map((milestone, index) => (
              <div key={`${milestone.title}-${index}`} className="milestone-card">
                <div className="milestone-number">{index + 1}</div>
                <input
                  className="form-input milestone-title"
                  placeholder={`Milestone ${index + 1} title`}
                  value={milestone.title}
                  onChange={(event) => updateMilestone(index, "title", event.target.value)}
                  disabled={isLoading}
                />
                <div className="amount-field">
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={milestone.amount}
                    onChange={(event) => updateMilestone(index, "amount", event.target.value)}
                    disabled={isLoading}
                  />
                  <span className="amount-suffix">{form.tokenType}</span>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => removeMilestone(index)}
                  disabled={isLoading || form.milestones.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="summary-bar">
          <span>Total amount to lock</span>
          <strong>{total > 0 ? `${total.toFixed(4)} ${form.tokenType}` : "-"}</strong>
        </div>

        <div className="form-hint-block">
          The escrow is created only when the wallet confirms the transaction. For MockUSDT,
          MetaMask will ask for approval first and escrow creation second.
        </div>

        {status?.type === "loading" && (
          <div className="message-box message-box--loading">{status.msg}</div>
        )}

        {status?.type === "success" && (
          <div className="message-box message-box--success">
            {status.msg}
            {txHash && <div className="tx-hash">Transaction: {txHash}</div>}
          </div>
        )}

        {status?.type === "error" && (
          <div className="message-box message-box--error">{status.msg}</div>
        )}

        <button className="primary-button" type="submit" disabled={isLoading || total <= 0}>
          {isLoading ? "Processing..." : "Create escrow"}
        </button>
      </form>
    </div>
  );
}
