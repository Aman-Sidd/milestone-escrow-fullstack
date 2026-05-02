import { useCallback, useEffect, useState } from "react";
import { EscrowStatusBadge, MilestoneStatusBadge } from "./StatusBadge";
import {
  calcProgress,
  fetchEscrowsForRole,
  formatAmount,
  formatDeadline,
  getTrustFlow,
  sendTx,
  shortAddr,
  subscribeToTrustFlowEvents,
} from "../utils/contract";

function getRemainingAmount(escrow) {
  return (BigInt(escrow.totalAmount) - BigInt(escrow.amountReleased)).toString();
}

export default function ArbiterDashboard({ account }) {
  const [escrows, setEscrows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState(null);
  const [activeAction, setActiveAction] = useState("");

  const loadEscrows = useCallback(async () => {
    setIsLoading(true);

    try {
      const results = await fetchEscrowsForRole(account, "arbiter");
      const sorted = [...results].sort((left, right) => right.id - left.id);
      setEscrows(sorted);
      setFeedback(null);
    } catch (error) {
      setFeedback({
        type: "error",
        msg: error?.shortMessage || error?.message || "Failed to load arbiter escrows.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [account]);

  useEffect(() => {
    loadEscrows();
  }, [loadEscrows]);

  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;

    subscribeToTrustFlowEvents(() => {
      loadEscrows();
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }

        unsubscribe = cleanup;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [loadEscrows]);

  async function handleResolveDispute(escrowId, freelancerWins) {
    const actionKey = `${escrowId}-${freelancerWins ? "freelancer" : "client"}`;
    setActiveAction(actionKey);
    setFeedback({ type: "loading", msg: "Confirm dispute resolution in MetaMask." });

    try {
      const trustFlow = await getTrustFlow();
      const result = await sendTx(() =>
        trustFlow.resolveDispute(BigInt(escrowId), freelancerWins)
      );

      if (!result.success) {
        setFeedback({ type: "error", msg: result.error });
        return;
      }

      setFeedback({
        type: "success",
        msg: `Dispute resolved for escrow #${escrowId}.`,
      });
      await loadEscrows();
    } catch (error) {
      setFeedback({
        type: "error",
        msg: error?.shortMessage || error?.message || "Failed to resolve dispute.",
      });
    } finally {
      setActiveAction("");
    }
  }

  const disputedEscrows = escrows.filter((escrow) => escrow.status === 2);

  return (
    <div className="client-dashboard">
      <div className="panel-header">
        <h2>Arbiter Dashboard</h2>
        <button className="secondary-button" onClick={loadEscrows} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="role-summary-grid">
        <div className="summary-tile">
          <span>Total assigned</span>
          <strong>{escrows.length}</strong>
        </div>
        <div className="summary-tile">
          <span>Needs resolution</span>
          <strong>{disputedEscrows.length}</strong>
        </div>
        <div className="summary-tile">
          <span>Resolved</span>
          <strong>{escrows.filter((escrow) => escrow.status === 3).length}</strong>
        </div>
      </div>

      <div className="message-box message-box--success">
        Viewing escrows assigned to arbiter <strong>{account}</strong>
      </div>

      {feedback?.type === "loading" && (
        <div className="message-box message-box--loading">{feedback.msg}</div>
      )}

      {feedback?.type === "success" && (
        <div className="message-box message-box--success">{feedback.msg}</div>
      )}

      {feedback?.type === "error" && (
        <div className="message-box message-box--error">{feedback.msg}</div>
      )}

      {isLoading ? (
        <div className="empty-state">Loading arbiter escrows...</div>
      ) : disputedEscrows.length === 0 ? (
        <div className="empty-state">
          No disputed escrows are assigned to this arbiter wallet right now.
        </div>
      ) : (
        <div className="escrow-list">
          {disputedEscrows.map((escrow) => {
            const progress = calcProgress(escrow.amountReleased, escrow.totalAmount);
            const remainingAmount = getRemainingAmount(escrow);

            return (
              <article key={escrow.id} className="escrow-card escrow-card--disputed">
                <div className="escrow-card__top">
                  <div>
                    <p className="escrow-id">Escrow #{escrow.id}</p>
                    <h3>Arbiter review required</h3>
                  </div>
                  <div className="card-header-meta">
                    <EscrowStatusBadge status={escrow.status} />
                    <span className="status-pill">
                      Remaining: {formatAmount(remainingAmount, escrow.tokenType)}
                    </span>
                  </div>
                </div>

                <div className="escrow-meta">
                  <div className="detail-row">
                    <span>Client</span>
                    <strong>{shortAddr(escrow.client)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Freelancer</span>
                    <strong>{shortAddr(escrow.freelancer)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Total amount</span>
                    <strong>{formatAmount(escrow.totalAmount, escrow.tokenType)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Deadline</span>
                    <strong>{formatDeadline(escrow.deadline)}</strong>
                  </div>
                </div>

                <div className="progress-block">
                  <div className="summary-bar">
                    <span>Released before dispute</span>
                    <strong>{progress}%</strong>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="milestones-list">
                  {escrow.milestones.map((milestone) => (
                    <div key={`${escrow.id}-${milestone.index}`} className="milestone-card">
                      <div className="milestone-number">{milestone.index + 1}</div>
                      <div className="milestone-copy">
                        <strong>{milestone.title}</strong>
                        <MilestoneStatusBadge status={milestone.status} />
                      </div>
                      <div className="milestone-copy">
                        <strong>{formatAmount(milestone.amount, escrow.tokenType)}</strong>
                        <span>Milestone amount</span>
                      </div>
                      <div className="milestone-state">Resolution handled at escrow level</div>
                    </div>
                  ))}
                </div>

                <div className="arbiter-actions">
                  <button
                    className="secondary-button"
                    onClick={() => handleResolveDispute(escrow.id, false)}
                    disabled={activeAction === `${escrow.id}-client`}
                  >
                    {activeAction === `${escrow.id}-client`
                      ? "Resolving..."
                      : "Award remaining funds to client"}
                  </button>
                  <button
                    className="primary-button arbiter-primary"
                    onClick={() => handleResolveDispute(escrow.id, true)}
                    disabled={activeAction === `${escrow.id}-freelancer`}
                  >
                    {activeAction === `${escrow.id}-freelancer`
                      ? "Resolving..."
                      : "Award remaining funds to freelancer"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
