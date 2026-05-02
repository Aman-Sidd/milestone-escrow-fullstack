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

function canSubmit(escrow, milestone) {
  return escrow.status === 0 && milestone.status === 0;
}

export default function FreelancerDashboard({ account }) {
  const [escrows, setEscrows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState(null);
  const [activeAction, setActiveAction] = useState("");

  const loadEscrows = useCallback(async () => {
    setIsLoading(true);

    try {
      const results = await fetchEscrowsForRole(account, "freelancer");
      const sorted = [...results].sort((left, right) => right.id - left.id);
      setEscrows(sorted);
      setFeedback(null);
    } catch (error) {
      setFeedback({
        type: "error",
        msg: error?.shortMessage || error?.message || "Failed to load freelancer escrows.",
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

  async function handleSubmitMilestone(escrowId, milestoneIndex) {
    const actionKey = `${escrowId}-${milestoneIndex}`;
    setActiveAction(actionKey);
    setFeedback({ type: "loading", msg: "Confirm milestone submission in MetaMask." });

    try {
      const trustFlow = await getTrustFlow();
      const result = await sendTx(() =>
        trustFlow.submitMilestone(BigInt(escrowId), BigInt(milestoneIndex))
      );

      if (!result.success) {
        setFeedback({ type: "error", msg: result.error });
        return;
      }

      setFeedback({
        type: "success",
        msg: `Milestone ${milestoneIndex + 1} submitted for review.`,
      });
      await loadEscrows();
    } catch (error) {
      setFeedback({
        type: "error",
        msg: error?.shortMessage || error?.message || "Failed to submit milestone.",
      });
    } finally {
      setActiveAction("");
    }
  }

  async function handleRaiseDispute(escrowId) {
    const actionKey = `${escrowId}-dispute`;
    setActiveAction(actionKey);
    setFeedback({ type: "loading", msg: "Confirm dispute raise in MetaMask." });

    try {
      const trustFlow = await getTrustFlow();
      const result = await sendTx(() => trustFlow.raiseDispute(BigInt(escrowId)));

      if (!result.success) {
        setFeedback({ type: "error", msg: result.error });
        return;
      }

      setFeedback({
        type: "success",
        msg: `Dispute raised for escrow #${escrowId}.`,
      });
      await loadEscrows();
    } catch (error) {
      setFeedback({
        type: "error",
        msg: error?.shortMessage || error?.message || "Failed to raise dispute.",
      });
    } finally {
      setActiveAction("");
    }
  }

  return (
    <div className="client-dashboard">
      <div className="panel-header">
        <h2>Freelancer Dashboard</h2>
        <button className="secondary-button" onClick={loadEscrows} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="role-summary-grid">
        <div className="summary-tile">
          <span>Total jobs</span>
          <strong>{escrows.length}</strong>
        </div>
        <div className="summary-tile">
          <span>Ready to submit</span>
          <strong>
            {
              escrows.filter((escrow) =>
                escrow.milestones.some((milestone) => canSubmit(escrow, milestone))
              ).length
            }
          </strong>
        </div>
        <div className="summary-tile">
          <span>Disputed</span>
          <strong>{escrows.filter((escrow) => escrow.status === 2).length}</strong>
        </div>
      </div>

      <div className="message-box message-box--success">
        Viewing escrows assigned to freelancer <strong>{account}</strong>
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
        <div className="empty-state">Loading freelancer escrows...</div>
      ) : escrows.length === 0 ? (
        <div className="empty-state">
          No escrows found for this freelancer wallet yet.
        </div>
      ) : (
        <div className="escrow-list">
          {escrows.map((escrow) => {
            const progress = calcProgress(escrow.amountReleased, escrow.totalAmount);

            return (
              <article
                key={escrow.id}
                className={`escrow-card ${escrow.status === 2 ? "escrow-card--disputed" : ""}`}
              >
                <div className="escrow-card__top">
                  <div>
                    <p className="escrow-id">Escrow #{escrow.id}</p>
                    <h3>Freelancer-assigned job</h3>
                  </div>
                  <div className="card-header-meta">
                    <EscrowStatusBadge status={escrow.status} />
                    <span className="status-pill status-pill--ok">
                      {formatAmount(escrow.totalAmount, escrow.tokenType)}
                    </span>
                  </div>
                </div>

                <div className="escrow-meta">
                  <div className="detail-row">
                    <span>Client</span>
                    <strong>{shortAddr(escrow.client)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Arbiter</span>
                    <strong>{shortAddr(escrow.arbiter)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Released</span>
                    <strong>{formatAmount(escrow.amountReleased, escrow.tokenType)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Deadline</span>
                    <strong>{formatDeadline(escrow.deadline)}</strong>
                  </div>
                </div>

                <div className="progress-block">
                  <div className="summary-bar">
                    <span>Progress</span>
                    <strong>{progress}%</strong>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="escrow-actions">
                  {escrow.status === 0 ? (
                    <button
                      className="secondary-button"
                      onClick={() => handleRaiseDispute(escrow.id)}
                      disabled={activeAction === `${escrow.id}-dispute`}
                    >
                      {activeAction === `${escrow.id}-dispute`
                        ? "Raising dispute..."
                        : "Raise dispute"}
                    </button>
                  ) : (
                    <div className="milestone-state">
                      {escrow.status === 2
                        ? "Dispute is active and waiting for arbiter resolution"
                        : "Dispute action unavailable for this escrow state"}
                    </div>
                  )}
                </div>

                <div className="milestones-list">
                  {escrow.milestones.map((milestone) => {
                    const actionKey = `${escrow.id}-${milestone.index}`;
                    return (
                      <div key={actionKey} className="milestone-card">
                        <div className="milestone-number">{milestone.index + 1}</div>
                        <div className="milestone-copy">
                          <strong>{milestone.title}</strong>
                          <MilestoneStatusBadge status={milestone.status} />
                        </div>
                        <div className="milestone-copy">
                          <strong>{formatAmount(milestone.amount, escrow.tokenType)}</strong>
                          <span>Milestone amount</span>
                        </div>
                        {canSubmit(escrow, milestone) ? (
                          <button
                            className="primary-button milestone-action"
                            onClick={() => handleSubmitMilestone(escrow.id, milestone.index)}
                            disabled={activeAction === actionKey}
                          >
                            {activeAction === actionKey ? "Submitting..." : "Submit"}
                          </button>
                        ) : (
                          <div className="milestone-state">
                            {escrow.status !== 0
                              ? "Escrow not active"
                              : milestone.status === 1
                                ? "Waiting for client review"
                                : milestone.status === 2
                                  ? "Already approved"
                                  : "Unavailable"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
